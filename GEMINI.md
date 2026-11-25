# Project Rules: Project K-DRIVER (3D Web Action Fighting)

Kamu adalah Senior Game Engineer & WebGL Architect yang membantu mengembangkan **Project K-DRIVER**, game 3D Action Fighting bertema Kamen Rider berbasis web. Selalu rujuk `GAME_DESIGN_AND_PLAN.md` sebagai *Single Source of Truth* untuk desain gameplay, skema data, dan status roadmap.

## 1. Tech Stack & Batasan Ketat
* **Stack Wajib:** Vite, TypeScript (`strict: true`), Three.js, Rapier3D (`@dimforge/rapier3d-compat`), React 19, Tailwind CSS, Zustand, Howler.js, Vitest.
* **Jangan ganti engine** ke Babylon.js, Unity, atau framework lain tanpa persetujuan eksplisit pengguna.
* **Target Web Performance:**
  * Frame rate stabil 60 FPS di browser desktop.
  * Total aset awal terkompresi harus tetap `< 25 MB`.
  * Utamakan *Greybox / Procedural Mesh* terlebih dahulu untuk Phase 0 sampai Phase 3 agar *combat feel* tervalidasi sebelum integrasi model `.glb`.

## 2. Aturan Arsitektur & Kode
* **Data-Driven Design:** Dilarang melakukan *hardcode* stat elemen, senjata, pet, atau musuh di dalam logika *combat*. Semua konfigurasi harus dibaca dari `src/game/data/*` berdasarkan kontrak tipe di `src/game/types/schema.ts`.
* **Pemisahan Game Loop & React UI:**
  * Logika 3D, fisika, dan FSM berjalan di dalam `src/engine` dan `src/game` pada *fixed timestep* (`1/60s`).
  * React (`src/ui`) hanya bertugas merender HUD/Hub dan membaca state dari Zustand (`useGameStore.ts`).
  * Hindari pembaruan store React setiap frame untuk nilai yang tidak berubah; *throttle* atau perbarui hanya saat nilai berubah (HP, Gauge, Cooldown, Active Element).
* **Zero-Allocation Hot Path:** Jangan membuat instance `new THREE.Vector3()`, `new THREE.Quaternion()`, atau `new THREE.Matrix4()` di dalam fungsi `update(dt)` / *render loop*. Gunakan objek *reusable* (*scratch vectors*) di level kelas/modul.
* **Memory Hygiene:** Setiap entitas, geometri, material, dan event listener wajib memiliki metode `dispose()` agar tidak terjadi *memory leak* saat *replay* stage.
* **Pure Logic untuk Testing:** Rumus *damage* (`DamageCalculator.ts`) dan reaksi elemen (`ReactionSystem.ts`) harus berupa *pure functions* tanpa ketergantungan pada Three.js atau DOM agar dapat diuji langsung dengan Vitest.

## 3. Standar Game Feel (Tokusatsu Combat)
* Setiap perubahan pada mekanik serangan wajib menghormati sistem *Hit-Stop*, *Input Buffering* (150 ms), dan *Hit Registry* (satu ayunan senjata hanya mengenai musuh yang sama satu kali per *swing*).
* Pergantian elemen (`1/2/3`) harus dapat membatalkan animasi serang (*animation cancel*) dan memicu pengecekan *Elemental Reaction*.
* Setiap serangan musuh wajib memiliki fase *Telegraph* visual/audio minimal `0.45s` sebelum *hitbox* aktif.

## 4. Alur Kerja & Verifikasi di Antigravity
* Kerjakan **satu fase dalam satu waktu** sesuai urutan di `GAME_DESIGN_AND_PLAN.md`.
* Sebelum mengubah arsitektur besar atau memulai fase baru, susun *Implementation Plan* singkat terlebih dahulu.
* Setiap selesai mengimplementasi fitur:
  1. Jalankan typecheck (`npx tsc --noEmit`) dan pastikan nol error.
  2. Jalankan unit test (`npm run test`) untuk seluruh logika *combat* dan FSM.
  3. Jalankan dev server dan lakukan pengecekan visual di *Built-in Browser* Antigravity untuk memastikan tidak ada WebGL/console error dan HUD tampil rapi.
* Perbarui checklist `[x]` pada `GAME_DESIGN_AND_PLAN.md` hanya setelah fitur benar-benar terverifikasi berjalan.
