# PRODUCT.md — Ensaio Fotográfico em Joinville (J26)

## Register

product — a galeria de entrega é UI de tarefa (ver, escolher, baixar fotos), não landing.
A landing/booking do mesmo repo é brand, mas não é o foco atual.

## Users

Mães de bailarinas (30–50 anos), quase todas em iPhone, muitas com pouca fluência
digital. Uma sessão típica: abrir o link do e-mail no Safari mobile, aceitar o termo,
ver as fotos da filha, baixar o zip. O padrão de qualidade que elas reconhecem é o
app Fotos do iOS — qualquer fricção abaixo disso lê como "site quebrado".

## Purpose

Entregar as fotos do ensaio com a mesma dignidade das fotos em si: portão de aceite
jurídico (CPF + autorização de imagem), grade de miniaturas, lightbox, download em
alta com pesquisa no primeiro clique.

## Brand personality

Elegante e pessoal ("andré ferreira" fotografia): serif itálica nos títulos
(font-headline), roxo #7a3f8f → coral #e87060 no CTA, fundo claro, muito espaço.
A foto é sempre a protagonista; o chrome é discreto.

## Anti-references

- Galeria de banco de imagens (Shutterstock): fria, densa, com marca d'água mental.
- Lightbox de site de notícia: setas gigantes, contadores berrantes, anúncio do lado.
- Qualquer coisa que pareça web de 2015 num iPhone de 2026.

## Strategic design principles

1. **Física do iOS como régua.** Gesto segue o dedo 1:1; soltar anima com curva
   ease-out; nada teleporta. Clientes comparam com o app Fotos, não com outros sites.
2. **A foto ocupa o palco.** Chrome preto puro no lightbox, controles que somem,
   grade sem moldura.
3. **Privacidade não regride.** `data-clarity-mask` em toda imagem e nome; eventos
   GA4/Clarity nunca carregam nome, CPF ou nascimento (só id da reserva e contagens).
4. **Sem dependência nova por capricho.** Vite + React + Tailwind v4; motion já está
   instalado se precisar; gestos críticos em Pointer Events nativos.
