#!/usr/bin/env python3
"""Sobe os previews 5678 de uma galeria para o R2, numerados como as fotos.

Uso:
  python3 scripts/subir-videos.py AG-MSFYY8ET '/Volumes/1TBssd/5678 Previews/53.Nicole'

Casa cada .mp4 (nomeado pelo stem da foto original) com o número da galeria via
staging/<ID>.mapa.json, copia como v/NNN.mp4 e escreve v/index.json — a página
descobre quais fotos têm vídeo lendo esse índice, sem tocar na planilha.

Fotos re-exportadas ganham sufixos de underscore (_MG_0168_(2)_.jpg) e a 0144
saiu sem o _(2): o casamento tenta o stem exato, depois sem underscores finais,
depois com _(2) acrescentado — mesmo clique, mesmo vídeo.
"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path

STAGING = Path(__file__).resolve().parent.parent / 'staging'

def main():
    gid, previews = sys.argv[1], Path(sys.argv[2])
    mapa = json.loads((STAGING / f'{gid}.mapa.json').read_text())   # "001.jpg" -> "_MG_0099_(2).jpg"
    mp4s = {p.stem: p for p in previews.iterdir() if p.suffix.lower() == '.mp4' and not p.name.startswith('.')}

    casados, sem_video = {}, []
    for nome, origem in sorted(mapa.items()):
        stem = Path(origem).stem
        base = stem.rstrip('_')
        alvo = next((c for c in (stem, base, base + '_(2)') if c in mp4s), None)
        if alvo: casados[nome[:3]] = mp4s[alvo]
        else:    sem_video.append(f'{nome[:3]} ({stem})')

    usados = {p for p in casados.values()}
    orfaos = [s for s, p in mp4s.items() if p not in usados]

    with tempfile.TemporaryDirectory() as td:
        v = Path(td) / 'v'; v.mkdir()
        for num, mp4 in casados.items():
            shutil.copy(mp4, v / f'{num}.mp4')
        (v / 'index.json').write_text(json.dumps({'v': 1, 'videos': sorted(casados)}))
        subprocess.run(['rclone', 'copy', str(v), f'r2:j26-galerias/{gid}/v', '--transfers', '8'], check=True)

    print(f'{len(casados)} vídeos subidos para {gid}/v/')
    print('sem vídeo (esperado p/ G9 e 5D3):', ', '.join(sem_video) or 'nenhum')
    print('mp4 órfãos (sem foto na galeria):', ', '.join(orfaos) or 'nenhum')

if __name__ == '__main__':
    main()
