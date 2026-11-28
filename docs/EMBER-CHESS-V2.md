# Ember Chess — v2 plan

Fitur CORE yang **tidak** dipaksa masuk APK v1. Ini bukan janji hasil, melainkan peta kerja yang menunggu approval Nodal.

## Prinsip

Engine v1 sudah terverifikasi perft dan tidak diubah. Semua fitur di bawah monoton di atasnya, bukan menggantikannya.

## Fase 1 — Stage cinematic lanjutan

- POV bidak dengan kamera bebas (orbit + exit), panah arah petak.
- Scene Adventure: satu chapter dengan plot twist, subtitle rail, blocking bidak.
- Impact frame lebih kaya (speed lines, freeze frame, audio sting), dengan skip.
- Suara reaksi EN dulu; dub ID menyusul.

## Fase 2 — Mode

- Rank & Puzzle: puzzle generator dari posisi legal, rating sederhana.
- Atomic: aturan ledakan + 3 kartu upgrade saat skak, sistem menyusul.
- Quest catur: Tower Defense, MCGG, Grow Tycoon, Epic Chess — versi catur, bukan mode generik.

## Fase 3 — Render

- 3D sungguhan (bukan 2.5D), shadow, bloom, material.
- Thesis: WebGL Lambert/Standard + post-processing ringan; target perangkat menengah.
- Fallback 2D tetap tersedia.

## Engine bot

- Lc0/Stockfish hanya bila ada jalur packaging yang sah dan ukuran APK masih wajar.
- Saat ini: hand-coded negamax level easy–expert.

## Aset yang masih harus diberi Nodal

- Logo SVG resmi pengganti mark inline di splash.
- Naskah/plot Adventure dan daftar quips bahasa Indonesia.
- Keputusan gaya final untuk mode Atomic (kartu, ikon, tema).

## Gate

Tidak ada fase yang dimulai sebelum Nodal menyetujui desain + lingkup fase sebelumnya. APK v1 tetap bisa di-verifikasi kapan saja.
