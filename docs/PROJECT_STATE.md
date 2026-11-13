# Project state — Aruna

Dipetakan 13 November 2026 (malam), di `main` commit `ea9e5a0`. Menggantikan peta pagi hari yang sama, yang sudah usang: sejak itu
attestor dan keeper berjalan di Railway, indexer pulih, dan Ilham menyambungkan sebagian besar layar console ke chain.

Label bukti: **[DIJALANKAN]** ada output asli dari sesi ini; **[DIBACA]** dari kode, belum dijalankan; **[TIDAK DIKETAHUI]**.

---

## 1. Ringkasan jujur

Aruna mengukur apakah kontrak yang disentuh agen masih bisa berubah, memakainya di vault (pembatas agen) dan di coverage (asuransi
parametrik terhadap perubahan kode). **Fasenya F4 (Konsolidasi), dengan catatan.** Tiga flow utama (measurement, protection,
coverage) berjalan penuh di testnet, dan hari ini untuk pertama kalinya coverage benar-benar bisa dijual: attestor dan keeper
berjalan sebagai service, `swap` ditugaskan, dan coverage #5 dibeli [DIJALANKAN]. Layar console hampir semuanya sudah membaca chain;
mock hanya tersisa di layar Guided demo. **Pembaruan 13 Nov, 19:15 UTC [DIJALANKAN]:** rantai penuh dengan service yang di-host pada perubahan kode baru di `swap`
(laporan 3 -> freeze -> `push_freeze` ke 8 vault -> verified -> `lift_freeze` + `set_class`), lalu klaim coverage #5 dari
console dibayar 0,08 NEAR. Transaksi di `docs/DEPLOY-ATTESTOR-KEEPER-RAILWAY.md`, "Recorded runs". **Yang belum:** retry SDK
pada freeze yang sudah dilepas (G2) belum dijalankan di chain; tidak ada audit independen; tidak ada pengguna di luar tim; semua masih testnet. Halaman console belum saya buka di
browser pada sesi ini.

---

## 2. Niat produk dan hal yang ambigu

Tidak berubah: pembeli pertama adalah perusahaan agent-as-a-service (satu vault per klien, klien sebagai owner, perusahaan sebagai
operator); janjinya satu URL yang menunjukkan apa yang **tidak bisa** dilakukan agen; mekanismenya policy -> exposure maksimum ->
harga premi (`docs/PRODUCT.md`).

Yang masih ambigu:

1. **Model pendapatan tidak punya kode.** Langganan, alert drift ke owner/operator, halaman publik ber-branding per perusahaan:
   tidak ada di `packages/*/src`, `apps/web/src` atau `contracts/*/src`. Belum tercatat apakah ini di luar v0.
2. **Alert saat service berhenti dengan sengaja tidak dibangun** (`docs/DEPLOY-ATTESTOR-KEEPER-RAILWAY.md`, "Considered and not built").
3. Folder luar `Aruna/` (di atas repo) masih berisi `CLAUDE.md`, `docs/`, `aruna-final/`, `prototype/`, `reference/` versi lama.

---

## 3. Peta komponen

| Komponen | Status | Bukti |
|---|---|---|
| `classifier-core`, `rpc`, `cli` | NYATA | 47, 32, 28 test lulus; `classify` pada akun mainnet dan testnet [DIJALANKAN] |
| `sdk` (+ builder catatan kelas, urutan risiko) | NYATA | 110 test lulus |
| `mcp` | NYATA | 22 test; `aruna_check_target` lewat stdio [DIJALANKAN] |
| `attestor` | NYATA, **di-host** | 38 test; log Railway: heartbeat tiap sekitar 3 menit, kunci cocok dengan registry, state bertahan setelah restart [DIJALANKAN oleh operator, log dibaca] |
| `keeper` | NYATA, **di-host** | 29 test; log Railway: `freeze lifted` lalu `class written` untuk `drift-target` [log dibaca] |
| `indexer` | NYATA, **di-host** | `/health`: `healthy:true`, `lag_blocks:0`, mode `following` [DIJALANKAN] |
| `sim` | NYATA | 36 test; hasil dipublikasikan dan dibaca console |
| Kontrak `vault`, `registry`, `pool`, `factory` | NYATA di testnet | view chain [DIJALANKAN]; test Rust sandbox tidak dijalankan di sesi ini |
| `apps/web`: landing, classifier, Overview, Agents, Playground, Create, Lookup, Coverage, Claims, Report, Pool, Targets, Attestor, Simulation, Migration (rencana) | NYATA, baca chain/registry/indexer | 329 test lulus; build lulus [DIJALANKAN]; layar dibaca dari kode, tidak dibuka di browser |
| `apps/web`: Guided demo (`Story`) | MOCK, berlabel mock | `story.ts` memakai `coverage-mock`, `claims-mock`, `vault-mock`, `mock` |
| Image Docker attestor dan keeper | NYATA | dibangun dan dijalankan lokal [DIJALANKAN] |
| Model pendapatan: langganan, alert, branding | TIDAK ADA | lihat §2 |
| Attestor independen dari Aruna | TIDAK ADA | syarat gate B |

---

## 4. Inkonsistensi dan penyimpangan

Selesai sejak peta pagi:

- Angka console (challenge 300 blok, `k` 5, konsentrasi 2 x, heartbeat basi 600 blok) sekarang sama dengan `params.rs`, dijaga test.
- README: langkah 5g, 5h, 5k, 5l, tabel scope dan langkah 16 disesuaikan dengan keadaan chain; `heartbeat_fresh`, `frozen` dan penugasan `swap` berubah hari ini.
- `contracts/adapters` (kosong) dihapus; lima berkas UI yang tidak diimpor siapa pun dihapus; `pnpm secret-scan` bersih.

Masih ada:

1. `docs/ATTESTOR.md` dan D-59 menggambarkan pelepasan freeze lewat tinjauan owner; D-67 menggantinya dengan pelepasan otomatis
   berdasarkan kelas, dan sudah mengoreksinya.
2. Layar pembelian coverage tidak memeriksa lebih dulu window di atas 30 hari atau kelas agen yang tidak cocok; pool menolaknya
   setelah transaksi dikirim (dua kali tadi). Belum terverifikasi seluruhnya di kode layar.
3. Daftar vault di console memakai pemilik yang tercatat saat registrasi, bukan pemilik sekarang (temuan audit L1, terbuka).
4. Temuan audit coverage L2 dan L3 terbuka (payout ke akun yang tidak bisa menerima, storage coverage dibayar pool).
5. ~~Tidak ada service yang memanggil `push_freeze`~~ (G1) dan freeze yang didorong tertinggal di cache vault setelah dilepas (G2):
   diperbaiki di keeper dan SDK (`e50fded`); G1 terbukti di chain 13 Nov. Lihat `docs/COMPONENT_MAP.md` §5.
6. Satu `set_class` manual setelah laporan membuat keeper menganggap target sudah ditangani; freeze-nya tinggal untuk operator.
7. Allowance key function-call 1 NEAR cukup sekitar 11 hari dengan heartbeat tiap 3 menit; tidak ada alert saat habis.
8. PR #55 (attestor dan keeper) digabung **tanpa** `ce-code-review`; hanya dibaca penulisnya.

---

## 5. Status flow utama

- **Measurement:** target -> kelas dan bukti, sampai output [DIJALANKAN]: CLI (`wrap.near`, empat fixture), MCP, perubahan tak terlihat (`fx-guser`).
- **Protection:** agen -> vault -> tolak atau terima -> exposure. Status chain sampai output [DIJALANKAN]: vault `demo2` `immutable_verified`, agen
  `injected` auto-disabled. Menjalankan agen dan membuat vault butuh wallet; tidak dijalankan di sesi ini.
- **Coverage, ujung ke ujung:** laporan drift -> freeze -> klaim dibayar [DIJALANKAN, chain]: coverage #2 dibayar 0,08 NEAR. Sekarang juga
  attestor hidup -> `heartbeat_fresh` `true` -> pembelian coverage #5 di `swap` [DIJALANKAN, chain dan transaksi]. Dua pembelian sebelumnya
  ditolak pool dengan alasan yang benar (kelas agen, window 47 hari).
- **Dengan service yang di-host, 13 Nov [DIJALANKAN, chain]:** perubahan kode baru pada `swap` -> laporan 3 oleh attestor-a (31 blok)
  -> freeze -> `push_freeze` oleh keeper ke 8 vault -> verified -> `lift_freeze` dan `set_class` oleh keeper -> klaim coverage #5
  dari console, 0,08 NEAR.

---

## 6. Fase

**F4 (Konsolidasi), bukan F5.** Bukti: hampir semua flow nyata dan konsisten (§3 dan §5); celah tinggal yang disebut di §4 dan §5. Bukan F5 karena
belum ada pengguna di luar tim, semuanya testnet, dan gate A (audit independen, cap TVL, pilot AaaS) belum terpenuhi.

---

## 7. Langkah berikutnya dan pertanyaan terbuka

1. ~~Uji rantai penuh dengan service yang di-host~~ dan ~~klaim dari console~~: selesai 13 Nov.
2. Jalankan satu `spend` lewat SDK baru pada vault yang masih menyimpan `swap` beku, untuk membuktikan G2 di chain.
3. Jalankan `ce-code-review` pada kode attestor, keeper dan SDK.
4. Pasang pemeriksaan di layar pembelian (window maksimal 30 hari, kelas agen) agar penolakan terjadi sebelum transaksi.
5. Sebelum 14 November 23:59 UTC: postingan demo, akun mainnet untuk hadiah, pilihan track, submit (`docs/BUILD-PLAN.md`).

Pertanyaan terbuka: apakah langganan, alert dan halaman ber-branding di luar v0; siapa yang menangani folder luar `Aruna/`.
