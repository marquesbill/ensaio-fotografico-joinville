#!/usr/bin/env python3
"""
Prepara as galerias de entrega: casa cada pasta de edição com a reserva,
gera as versões de tela e emite o que deve ser colado na planilha.

Uso:
  python3 scripts/preparar-galerias.py                 # só relatório do pareamento (nada é escrito)
  python3 scripts/preparar-galerias.py --gerar         # gera as imagens de tela em ./staging
  python3 scripts/preparar-galerias.py --gerar --zip   # + fotos.zip (originais) por galeria, ~20 GB
  python3 scripts/preparar-galerias.py --gerar --so AG-MP14EJRV   # uma reserva

Não toca nos originais: lê os JPGs finais e escreve cópias redimensionadas em ./staging.
O upload para o R2 é um passo separado (scripts/subir-r2.sh), feito depois do pareamento conferido.
"""
import difflib, json, os, re, subprocess, sys, unicodedata, urllib.request, zipfile
from pathlib import Path

RAIZ    = Path('/Volumes/1TBssd/edição join26')
STAGING = Path(__file__).resolve().parent.parent / 'staging'
LARGURA = 2048          # lado maior das imagens de tela
QUALIDADE = 82
LARGURA_T = 640         # lado maior das miniaturas da grade (subpasta t/)
QUALIDADE_T = 70
GS = ('https://script.google.com/macros/s/AKfycby4RQxi6a4DTR1ml-LlJkK5D4GOCPug5'
      'SIB-GmRrCa0uu2U3Dgtrj4vzgm_Owzz285eGQ/exec')


def normaliza(s: str) -> str:
    """Minúsculas, sem acento, sem pontuação — para casar nomes de pasta com nomes da planilha."""
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9 ]', ' ', s.lower()).strip()


def tokens(s: str) -> set:
    # ignora numeração da pasta ("5.") e o sufixo de bailarinas ("1b", "10b")
    return {t for t in normaliza(s).split() if len(t) > 2 and not re.fullmatch(r'\d+b?', t)}


def carregar_reservas():
    url = f'{GS}?action=bookings&t=0'
    with urllib.request.urlopen(url, timeout=120) as r:
        todas = json.load(r)
    return [b for b in todas
            if '2026-07-19' <= b.get('date', '') <= '2026-08-02'
            and b.get('status') in ('Confirmado', 'Pago Parcial')]


# Pastas que o casamento por palavra não resolve — nome da pasta → ID da reserva.
# Deliberadamente MANUAL: correspondência aproximada (difflib e afins) casaria
# "53.Nicole" com "Nicolle Lourenço" sozinha, mas também casaria nomes parecidos
# de clientes diferentes. Num sistema que entrega fotos, um palpite errado manda
# as imagens de uma pessoa para outra — o preço de errar não paga a conveniência.
# O relatório SEM PAR sugere o candidato; quem confirma é você, aqui.
PARES_MANUAIS = {
    '53.Nicole': 'AG-MSFYY8ET',      # pasta "Nicole", reserva "Nicolle Lourenço" (um L a menos)
}


def parear(pastas, reservas):
    """Casa pasta → reserva: primeiro PARES_MANUAIS, depois tokens em comum no nome."""
    pares, sem_par = [], []
    usadas = set()
    por_id = {b['id']: b for b in reservas}

    for pasta in pastas:
        nome_pasta = pasta.parent.name

        # 1) override explícito
        alvo = PARES_MANUAIS.get(nome_pasta)
        if alvo:
            b = por_id.get(alvo)
            if b and b['id'] not in usadas:
                usadas.add(b['id'])
                pares.append((pasta, b, 99))     # 99 = casado à mão
                continue
            print(f'  ⚠ PARES_MANUAIS aponta {nome_pasta} → {alvo}, '
                  f'{"já usado" if b else "que não existe entre as reservas ativas"}')

        # 2) tokens em comum
        tp = tokens(nome_pasta)
        melhor, score = None, 0
        for b in reservas:
            if b['id'] in usadas:
                continue
            s = len(tp & tokens(b.get('name', '')))
            if s > score:
                melhor, score = b, s
        if melhor and score >= 2:          # 2 tokens = nome + sobrenome batendo
            usadas.add(melhor['id'])
            pares.append((pasta, melhor, score))
        else:
            sem_par.append((pasta, melhor, score))

    faltando = [b for b in reservas if b['id'] not in usadas]
    return pares, sem_par, faltando


def _fotos(pasta: Path) -> list:
    """Os JPEGs de verdade da pasta, em ordem.

    Descarta os ocultos: em volume externo o macOS deixa um AppleDouble `._nome.jpg`
    ao lado de cada arquivo (1.328 deles no SSD do J26). O sips morre neles com exit 13,
    e contá-los dobrava o número de fotos no relatório de pareamento.
    """
    return sorted(p for p in pasta.iterdir()
                  if p.suffix.lower() in ('.jpg', '.jpeg') and not p.name.startswith('.'))


def _sips(origem: Path, saida: Path, lado: int, qualidade: int):
    """Redimensiona com o sips do próprio macOS. Pula o que já existe (permite retomar)."""
    if saida.exists():
        return
    subprocess.run(
        ['sips', '-Z', str(lado), '-s', 'format', 'jpeg',
         '-s', 'formatOptions', str(qualidade), str(origem), '--out', str(saida)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _zip(pasta: Path, destino: Path, fotos: list):
    """Monta staging/<id>/fotos.zip com os ORIGINAIS em resolução cheia.

    É o "baixar em alta" da galeria — a coluna `Galeria Link` aponta para ele.
    Sem compressão (ZIP_STORED): JPEG já vem comprimido, então DEFLATE gastaria
    minutos de CPU por galeria para ganhar quase nada.
    Os nomes dentro do zip seguem a numeração da grade (001.jpg…), para a cliente
    achar no zip a mesma foto que viu na tela.
    """
    saida = destino / 'fotos.zip'
    # Refaz se a contagem divergir: zip velho de uma edição anterior entregaria
    # um conjunto diferente do que a galeria mostra, e em silêncio.
    if saida.exists():
        try:
            with zipfile.ZipFile(saida) as z:
                if len(z.namelist()) == len(fotos):
                    return
        except zipfile.BadZipFile:
            pass                      # zip truncado de uma execução interrompida
        saida.unlink()
    parcial = saida.with_suffix('.zip.parcial')
    with zipfile.ZipFile(parcial, 'w', zipfile.ZIP_STORED) as z:
        for i, foto in enumerate(fotos, 1):
            z.write(foto, arcname=f'{i:03d}.jpg')
    parcial.rename(saida)             # só vira fotos.zip quando está completo


def gerar(pasta: Path, booking_id: str, com_zip: bool = False) -> list:
    """Gera a versão de tela em staging/<id>/ e a miniatura em staging/<id>/t/.

    A grade da galeria carrega só as miniaturas: 138 fotos a 2048px são ~80 MB no
    celular. Ambas saem do original — a miniatura NÃO é reamostrada da versão de
    tela, para não acumular perda de duas compressões JPEG.
    """
    destino = STAGING / booking_id
    (destino / 't').mkdir(parents=True, exist_ok=True)
    fotos, nomes = _fotos(pasta), []
    for i, foto in enumerate(fotos, 1):
        nome = f'{i:03d}.jpg'
        _sips(foto, destino / nome,       LARGURA,   QUALIDADE)
        _sips(foto, destino / 't' / nome, LARGURA_T, QUALIDADE_T)
        nomes.append(nome)
    if com_zip:
        _zip(pasta, destino, fotos)
    return nomes


def main():
    gerar_imagens = '--gerar' in sys.argv
    com_zip       = '--zip' in sys.argv    # separado: são ~20 GB, bem mais lento que as imagens
    so = None
    if '--so' in sys.argv:
        so = sys.argv[sys.argv.index('--so') + 1]

    if not RAIZ.exists():
        sys.exit(f'Pasta não encontrada: {RAIZ}  (o SSD está conectado?)')

    pastas = sorted(RAIZ.glob('*/jpgFinais'))
    reservas = carregar_reservas()
    print(f'{len(pastas)} pastas com jpgFinais · {len(reservas)} reservas ativas\n')

    pares, sem_par, faltando = parear(pastas, reservas)

    print('PAREADAS')
    linhas_csv = []
    for pasta, b, score in pares:
        if so and b['id'] != so:
            continue
        qtd = len(_fotos(pasta))
        print(f'  {b["id"]}  {qtd:3d} fotos  {b["name"][:38]:38s} ← {pasta.parent.name}')
        if gerar_imagens:
            nomes = gerar(pasta, b['id'], com_zip)
            linhas_csv.append((b['id'], b['id'], '|'.join(nomes)))
            extra = ''
            if com_zip:
                z = STAGING / b['id'] / 'fotos.zip'
                extra = f' + fotos.zip ({z.stat().st_size // 1024 // 1024} MB)' if z.exists() else ' + zip FALHOU'
            print(f'      → {len(nomes)} de tela + {len(nomes)} miniaturas{extra} em staging/{b["id"]}/')

    if sem_par:
        print('\nSEM PAR — confira e, se estiver certo, adicione em PARES_MANUAIS no topo do script')
        # Semelhança serve só para SUGERIR aqui. O pareamento de verdade nunca sai
        # daqui: quem decide é o PARES_MANUAIS, depois de você confirmar.
        candidatos = [(' '.join(sorted(tokens(b['name']))), b['name'], b['id']) for b in faltando]
        for pasta, melhor, score in sem_par:
            if melhor and score:
                palpite = f'palpite: {melhor["name"]} ({score} palavra em comum)'
            else:
                alvo = ' '.join(sorted(tokens(pasta.parent.name)))
                achou = max(candidatos,
                            key=lambda c: difflib.SequenceMatcher(None, alvo, c[0]).ratio(),
                            default=None)
                r = difflib.SequenceMatcher(None, alvo, achou[0]).ratio() if achou else 0
                palpite = (f"parecido {r:.0%}: {achou[1]}  →  '{pasta.parent.name}': '{achou[2]}',"
                           if achou and r >= 0.5 else 'nenhum palpite')
            print(f'  {pasta.parent.name}  →  {palpite}')

    if faltando:
        print('\nRESERVAS SEM PASTA (edição ainda não terminou?)')
        for b in faltando:
            print(f'  {b["id"]}  {b["name"][:40]}')

    if linhas_csv:
        destino = STAGING / 'planilha.csv'
        with open(destino, 'w') as f:
            f.write('ID\tGaleria Pasta\tGaleria Fotos\n')
            for lin in linhas_csv:
                f.write('\t'.join(lin) + '\n')
        print(f'\nColar na planilha: {destino}')


if __name__ == '__main__':
    main()
