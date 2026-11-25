# Project K-DRIVER: Elemental Rider 3D (Web Action Fighting)

Dokumen ini adalah *Single Source of Truth* (GDD, Spesifikasi Teknis, Skema Data, dan Rencana Eksekusi) untuk membangun game **3D Action Fighting** bertema *Kamen Rider / Tokusatsu* berbasis web, dirancang khusus untuk alur kerja **Spec-Driven Development** di **Google Antigravity** bersama **Gemini 4 Neon**.

---

## 1. Ringkasan Proyek & Visi

* **Judul Kerja:** Project K-DRIVER *(placeholder)*
* **Genre:** 3D Action Fighting / Hack-and-Slash (Stage-Based Hub + Arena)
* **Platform Target:** Web Browser Desktop (Chrome, Edge, Firefox — WebGL2 / WebGPU-ready)
* **Target Performa:** Stabil $60\text{ FPS}$ pada laptop kelas menengah, ukuran aset awal terkompresi $< 25\text{ MB}$, *initial load* $< 8\text{ detik}$.
* **Gaya Visual:** *Stylized Low-Poly / Cel-Shaded Tokusatsu* (warna armor kontras, efek partikel tajam, siluet senjata & helm ikonik).

### Empat Pilar Desain (Core Pillars)
1. **Fluid Form-Switching:** Mengganti *Elemental Gem* di tengah kombo tanpa jeda kaku untuk memicu reaksi elemen.
2. **Tactile Tokusatsu Combat:** Pukulan terasa berbobot melalui *hit-stop*, *camera shake*, *telegraph* serangan musuh, dan *Perfect Dodge*.
3. **Elemental Pet Synergy:** *Pet* bukan sekadar kosmetik; mereka memberi *buff* pasif, serangan *assist* aktif, dan hadir dalam *Ultimate Finisher*.
4. **Escalating Henshin Climax:** Alur bertarung selalu memuncak dari **Basic Form** ke **Super Form**, lalu ditutup dengan **Ultimate Form / Finisher** sinematik.

---

## 2. Arsitektur & Tech Stack Rekomendasi

Tech stack ini dipilih agar sangat ramah untuk pengembangan berbasis agen AI di Google Antigravity (TypeScript ketat, *hot-reload* cepat, mudah diverifikasi lewat *Built-in Browser* Antigravity):

| Layer | Teknologi | Alasan Pemilihan |
| :--- | :--- | :--- |
| **Build Tool & Bahasa** | **Vite + TypeScript (Strict Mode)** | Kompilasi instan, deteksi *bug* tipe data sejak dini, ideal untuk skema *data-driven*. |
| **3D Rendering Engine** | **Three.js** | Ringan untuk web, kontrol penuh atas shader cel-shading/material swap, ekosistem sangat matang. |
| **Physics & Collision** | **Rapier3D (`@dimforge/rapier3d-compat`)** | *Engine* fisika WASM cepat untuk *character controller*, *hitbox/hurtbox*, dan batas arena. |
| **UI / HUD & Hub Menu** | **React 19 + Tailwind CSS** | Membuat HUD kompleks (Driver Gauge, Gem Wheel, Boss HP, Loadout Hub) jauh lebih cepat dan responsif. |
| **State Bridge** | **Zustand** | Menjembatani state *game loop* ($60\text{ Hz}$) ke React HUD secara selektif tanpa merusak *frame rate*. |
| **Audio** | **Howler.js** + Web Audio API | Manajemen *SFX Henshin*, *jingle* ganti elemen, dan *procedural synth fallback* selama fase greybox. |
| **Testing** | **Vitest** | Unit test otomatis untuk rumus *damage*, reaksi elemen, *cooldown*, dan transisi *State Machine*. |
| **Format Aset 3D** | **glTF / `.glb` (Draco + WebP/KTX2)** | Ukuran file minimal dengan dukungan *skeletal animation* standar dari Blender/Mixamo. |

---

## 3. Desain Sistem Gameplay Mendalam

### 3.1. Strategi Scope: MVP (3 Elemen) menuju Full Roster (10 Elemen)

Arsitektur dibangun *data-driven* sejak hari pertama agar penambahan elemen baru cukup melalui entri konfigurasi dan aset modular tanpa mengubah *core combat engine*.

#### A. Starter Roster (Wajib Selesai di MVP)

| Elemen | Kode | Senjata | Archetype Animasi | Pet & Skill Assist | Status Effect | Peran Tempur |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Api (Pyro)** | `pyro` | Greatsword | `HEAVY_MELEE` | **Phoenix** — Menukik meledakkan area api | `BURN` (DoT) | *Heavy Bruiser* & pemecah guard |
| **Petir (Volt)** | `volt` | Dual Dagger | `FAST_MELEE` | **Raiju (Wolf)** — Menerjang cepat + *stun* | `SHOCK` (Rentan crit) | *Speedster* & pengisi Driver Gauge |
| **Air (Aqua)** | `aqua` | Tombak / Trident | `POLEARM` | **Leviathan (Serpent)** — Gelombang air (*slow* + *heal* tipis) | `WET` (Perlambat gerak) | *Crowd Control* & bertahan |

#### B. Expansion Roster (Pasca-MVP — Siap Masuk Skema Data)

| Elemen | Senjata | Archetype Animasi | Pet | Status / Efek Khas |
| :--- | :--- | :--- | :--- | :--- |
| **Tanah (Terra)** | Great Axe | `HEAVY_MELEE` | **Mammoth** | *Stagger* tinggi + perisai sementara (*Shield*) |
| **Angin (Aero)** | Rapier | `FAST_MELEE` | **Griffin / Falcon** | Tarikan pusaran (*Pull*) + mobilitas udara |
| **Forest (Flora)** | Bow (Panah) | `RANGED` | **Stag / Treant** | Akar pengikat (*Root*) + regenerasi stamina |
| **Sun (Solar)** | Broadsword | `POLEARM` | **Solar Lion** | Ledakan cahaya *Blind* + bonus *damage* area |
| **Moon (Lunar)** | Scythe | `HEAVY_MELEE` | **Silver Owl / Wolf** | *Lifesteal* + efek *Slow-mo* area singkat |
| **Dark (Umbra)** | Dual Gun | `RANGED` | **Shadow Dragon** | *Armor Shred* + *mark* peledak tertunda |
| **Light (Lux)** | Lance / Spear | `POLEARM` | **Unicorn** | *Cleanse debuff* + sinar laser penembus lurus |

> **Strategi Shared Rig & 4 Archetype:** Semua 10+ senjata dipetakan ke hanya **4 set animasi dasar** (`FAST_MELEE`, `HEAVY_MELEE`, `POLEARM`, `RANGED`) pada satu *skeleton* Rider yang sama. Ini memangkas kebutuhan produksi animasi hingga $60\%$.

---

### 3.2. Sistem Reaksi Elemen (Elemental Combo Matrix)

Mengganti Gem saat musuh memiliki status elemen aktif akan memicu **Elemental Reaction** (konsumsi status untuk efek bonus besar):

| Status Awal di Musuh | Pemicu Elemen Baru | Nama Reaksi | Efek Mekanik |
| :--- | :--- | :--- | :--- |
| `WET` (Air) | `volt` (Petir) | **Electro-Surge** | Ledakan petir berantai ke musuh terdekat + kerusakan $2.5\times$ ke *Guard Bar* (Armor Break). |
| `WET` (Air) | `pyro` (Api) | **Steam Burst** | Ledakan uap radius sedang dengan *damage* instan $1.8\times$ + *knockback* kuat. |
| `BURN` (Api) | `volt` (Petir) | **Overload** | 3 ledakan mikro beruntun + menggandakan perolehan *Driver Gauge* ($2.0\times$). |
| *(Ekspansi)* `ROOT` | `pyro` (Api) | **Wildfire** | Area terbakar permanen selama $4\text{ detik}$. |
| *(Ekspansi)* `MARK` (Dark) | `lux` (Light) | **Eclipse** | *True Damage* mengabaikan pertahanan musuh. |

---

### 3.3. Sistem Evolusi Form Rider (Basic -> Super -> Ultimate)

| Tingkatan Form | Cara Aktivasi | Perubahan Visual (Modular) | Buff & Kemampuan Khusus |
| :--- | :--- | :--- | :--- |
| **Basic Form** | Aktif sejak awal stage (`1`/`2`/`3` ganti elemen) | *Base Rider Mesh*, warna/shader emissive sesuai elemen, senjata elemen aktif. | Kombo 3-hit, 1 Skill Elemen (`Q`), 1 Pet Assist (`E`). |
| **Super Form** | Saat **Driver Gauge** mencapai $100\%$ -> tekan `F` (durasi $18\text{ detik}$) | Pasang *armor attachments* (bahu, dada, jubah/sayap), aura partikel intens, *shockwave* aktivasi. | *Damage* $+30\%$, *attack speed* $+15\%$, *Super Armor* ringan, Skill `Q` berevolusi menjadi *Super Skill*. |
| **Ultimate Form & Finisher** | Selama Super Form, isi **Overdrive Bar** hingga $100\%$ (atau saat Boss *Staggered*) -> tekan `F` | Transisi kamera sinematik ($3.5\text{ detik}$): Rider berubah ke *Ultimate Aura* + **Pet muncul penuh di belakang Rider**. | Serangan gabungan pamungkas skala besar (kebal selama animasi), diakhiri pose membelakangi ledakan monster. |

---

### 3.4. Formula Perhitungan Damage & Gauge

Perhitungan *damage* dikelola terpusat di modul murni (`DamageCalculator.ts`) agar mudah diuji dengan Vitest:

$$D_{\text{final}} = \left\lfloor D_{\text{base}} \times M_{\text{skill}} \times M_{\text{form}} \times M_{\text{reaction}} \times M_{\text{crit}} \times \left(\frac{100}{100 + \text{DEF}_{\text{eff}}}\right) \right\rfloor$$

Dengan definisi variabel:
* $D_{\text{base}}$: Kekuatan serangan dasar senjata elemen aktif.
* $M_{\text{skill}}$: Pengali gerakan (contoh: Hit 1 = $1.0$, Hit 2 = $1.15$, Hit 3 = $1.5$, Skill = $2.2$, Ultimate = $6.0$).
* $M_{\text{form}}$: Basic = $1.0$, Super = $1.3$, Ultimate = $1.6$.
* $M_{\text{reaction}}$: $1.0$ (tanpa reaksi), $1.5$ sampai $1.8$ saat reaksi elemen terpicu.
* $M_{\text{crit}}$: $1.5$ jika *Critical Hit* (peluang dasar $10\%$, meningkat $+25\%$ pada musuh berstatus `SHOCK`), selain itu $1.0$.
* $\text{DEF}_{\text{eff}}$: Pertahanan efektif musuh (berkurang $50\%$ saat status *Staggered* / *Guard Broken*).

Perolehan *Driver Gauge* ($G$) per serangan yang mengenai musuh:

$$\Delta G = G_{\text{hit}} \times M_{\text{switch}} \times M_{\text{dodge}}$$

* $G_{\text{hit}}$: Nilai dasar pengisian (Fast Melee: $4$, Polearm: $6$, Heavy Melee: $8$).
* $M_{\text{switch}}$: $2.0$ jika memicu reaksi elemen dalam $2\text{ detik}$ setelah mengganti Gem.
* $M_{\text{dodge}}$: Bonus langsung $+15$ gauge setiap kali berhasil melakukan *Perfect Dodge*.

---

### 3.5. Tingkatan Musuh (Monster Hierarchy)

| Tier | Contoh MVP | HP / Guard | Pola AI & Mekanik | Tujuan Desain |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1: Minion** | *Shadow Grunt* | HP rendah ($120$), tanpa Guard | Mendekat berkerumun, 1 serangan *telegraph* lambat ($0.7\text{ detik}$). | Pemanasan kombo, sumber *Gem Shard*, dan pengisi awal *Driver Gauge*. |
| **Tier 2: Elite** | *Armored Brute* | HP sedang ($450$), Guard Bar ($150$) | Punya *Super Armor* selama Guard Bar $> 0$. Serangan *slam* area. | Mendorong pemain memakai reaksi *Electro-Surge* atau *Heavy Attack* Api untuk memecah perisai. |
| **Tier 3: Mini-Boss** | *(Pasca-MVP)* *Elemental General* | HP tinggi, resistensi 1 elemen | Bisa berpindah posisi cepat dan memanggil 2 minion. | Ujian penguasaan rotasi multi-elemen di stage lanjutan. |
| **Tier 4: Stage Boss** | *Obsidian Kaijin* | HP besar ($1800$), 2 Fase + *Stagger Bar* | **Fase 1:** Tebasan 2-hit + lompatan area. **Fase 2 (HP $< 50\%$):** Aura gelap, proyektil energi, kombo 3-hit cepat. | Klimaks MVP untuk aktivasi **Super Form** dan eksekusi **Ultimate Finisher**. |

---

## 4. Combat Loop, State Machine & Game Feel

### 4.1. Alur Permainan (Macro Loop)
1. **Loadout Hub (3D Pedestal + UI):** Pilih 3 Gem aktif (untuk MVP: Api, Petir, Air), lihat pratinjau model Rider & Pet, baca ringkasan reaksi elemen, klik **Deploy**.
2. **Arena Entry:** Transisi kamera cepat ($1.8\text{ detik}$) dengan animasi *Henshin* dasar.
3. **3-Wave Combat Arena:**
   * **Wave 1:** 5 Minion (*Shadow Grunt*)
   * **Wave 2:** 1 Elite (*Armored Brute*) + 3 Minion
   * **Wave 3:** 1 Stage Boss (*Obsidian Kaijin*)
4. **Climax & Result Screen:** Skor dihitung dari waktu selesai, *damage* diterima, jumlah reaksi elemen, dan apakah Boss dikalahkan dengan *Finisher* -> Rank `S` / `A` / `B` / `C`. Progres & rekor tersimpan di `localStorage`.

### 4.2. Finite State Machine (Player FSM)

```text
[IDLE] <---> [MOVE]
  |             |
  +--> [ATTACK_1] -> [ATTACK_2] -> [ATTACK_3]  (bisa cancel ke DODGE atau FORM_SWITCH)
  |
  +--> [ELEMENT_SKILL (Q)]
  |
  +--> [DODGE] (i-frames 0.25s -> jika kena hitbox musuh => trigger PERFECT_DODGE)
  |
  +--> [FORM_SWITCH (1/2/3)] (durasi singkat 0.2s, burst cahaya di sabuk, ganti senjata & shader)
  |
  +--> [HENSHIN_SUPER (F)] (invulnerable 1.0s, radial knockback, pasang armor Super)
  |
  +--> [ULTIMATE_CINEMATIC (F)] (invulnerable 3.5s, kontrol kamera timeline, summon Pet)
  |
  +--> [HITSTUN] -> [IDLE] (atau [DEAD] jika HP <= 0)
```

*(Catatan: Panggilan Pet `E` berjalan secara asinkron/paralel tanpa mengunci gerakan Rider, kecuali memicu animasi singkat pada lengan kiri/sabuk).*

### 4.3. Parameter Game Feel Wajib
* **Hit-Stop:** Jeda *time-scale* khusus animasi/fisika selama $40\text{ ms}$ (Fast), $55\text{ ms}$ (Polearm), dan $75\text{ ms}$ (Heavy / Hit ke-3).
* **Input Buffering:** Buffer tombol serang/dodge selama $150\text{ ms}$ sebelum *recovery window* berakhir.
* **Perfect Dodge:** Jika *hurtbox* pemain bersinggungan dengan serangan musuh selama jendela *i-frame* ($0.25\text{ detik}$), aktifkan *global time-scale* $0.25\times$ selama $0.6\text{ detik}$, efek *chromatic aberration* / kilatan biru, dan $+15$ *Driver Gauge*.
* **Telegraph Musuh:** Setiap serangan musuh wajib memancarkan kilatan merah (*emissive flash*) + bunyi *cue* minimal $0.45\text{ detik}$ sebelum *active hitbox*.
* **Target Lock-On (`Tab` / Middle Click):** Menjaga kamera tetap membingkai pemain dan target utama dengan interpolasi lembut (*damped slerp*).

### 4.4. Skema Kontrol (Keyboard + Mouse)

| Input | Fungsi | Detail |
| :--- | :--- | :--- |
| `W A S D` | Gerak karakter | Relatif terhadap orientasi kamera *third-person*. |
| `Mouse Move` | Rotasi kamera | *Pointer Lock* saat di arena, bebas saat pause/menu. |
| `Klik Kiri` | Kombo Serangan (1-2-3) | Mendukung *input buffering*. |
| `Klik Kanan` / `Shift` | Dodge / Dash | *Cooldown* $0.6\text{ detik}$, punya *i-frames*. |
| `1`, `2`, `3` | Switch Element Gem | Api (`1`), Petir (`2`), Air (`3`). *Animation cancel* aktif, *cooldown* global $1.2\text{ detik}$. |
| `Q` | Element Skill | *Cooldown* per elemen ($6\text{--}8\text{ detik}$). |
| `E` | Summon Pet Assist | *Cooldown* per Pet ($10\text{--}12\text{ detik}$). |
| `F` | Henshin Super / Ultimate | Tombol kontekstual sesuai isi *Driver Gauge* / *Overdrive Bar*. |
| `Tab` / `Klik Tengah` | Toggle Lock-On | Mengunci ke Elite/Boss terdekat. |
| `Esc` | Pause / Release Cursor | Membuka menu jeda dan pengaturan grafis/audio. |

---

## 5. Struktur Direktori & Skema Data Teknis

### 5.1. Struktur Folder Proyek

```text
project-k-driver/
├── GEMINI.md                     # Aturan proyek always-on untuk Google Antigravity
├── GAME_DESIGN_AND_PLAN.md       # Dokumen spesifikasi & rencana ini
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── assets/
│       ├── models/               # .glb terkompresi Draco (rider, weapons, pets, enemies, arena)
│       ├── audio/                # SFX Henshin, slash, hit, BGM
│       └── textures/             # Ramp textures untuk cel-shading, particle sprites (WebP)
└── src/
    ├── main.tsx                  # Entry point React
    ├── App.tsx                   # Switcher layar: Hub <-> Arena <-> Result
    ├── engine/
    │   ├── GameApp.ts            # Orchestrator Three.js, renderer, resize, lifecycle
    │   ├── Loop.ts               # Fixed timestep physics (60Hz) + variable render loop + hit-stop
    │   ├── InputManager.ts       # Keyboard, Mouse, PointerLock, Input Buffering
    │   ├── CameraRig.ts          # Third-person orbit, lock-on framing, shake, cinematic timeline
    │   ├── PhysicsWorld.ts       # Wrapper Rapier3D (rigidbodies, character controller, hitbox queries)
    │   ├── AssetLoader.ts        # GLTFLoader + DRACOLoader + caching + progress callback
    │   └── AudioManager.ts       # Wrapper Howler.js + Web Audio procedural fallback
    ├── game/
    │   ├── types/
    │   │   └── schema.ts         # Interface TypeScript untuk Elemen, Weapon, Pet, Enemy, Wave
    │   ├── data/
    │   │   ├── elements.ts       # Konfigurasi data-driven Pyro, Volt, Aqua (+ slot ekspansi)
    │   │   ├── enemies.ts        # Konfigurasi Minion, Elite, Boss
    │   │   └── stages.ts         # Konfigurasi arena & 3 Wave MVP
    │   ├── combat/
    │   │   ├── DamageCalculator.ts   # Formula damage, crit, guard break (pure functions)
    │   │   ├── ReactionSystem.ts     # Deteksi & eksekusi reaksi elemen (pure functions)
    │   │   └── HitboxSystem.ts       # Active frame window, hit registry (mencegah multi-hit 1 ayunan)
    │   ├── entities/
    │   │   ├── PlayerRider.ts        # FSM Player, modular armor toggle, weapon socket swap
    │   │   ├── PetEntity.ts          # Summon singkat, proyektil/AoE skill, posisi Ultimate
    │   │   ├── EnemyBase.ts          # Base FSM musuh, telegraph flash, guard/stagger bar
    │   │   └── BossKaijin.ts         # AI 2-fase khusus Stage Boss
    │   ├── vfx/
    │   │   ├── ParticlePool.ts       # Object-pooled particles (api, petir, air, ledakan)
    │   │   └── SlashTrail.ts         # Mesh ribbon trail untuk ayunan senjata
    │   └── StageManager.ts           # Spawner wave, trigger transisi, kalkulasi Rank
    ├── store/
    │   └── useGameStore.ts       # Zustand store untuk sinkronisasi HUD & Save Data
    ├── ui/
    │   ├── LoadoutHub.tsx        # Layar pilih Gem & pratinjau Rider
    │   ├── CombatHUD.tsx         # HP, Driver Gauge, Overdrive, Gem Slots, Cooldowns, Boss Bar
    │   ├── DamageNumbers.tsx     # Floating damage & teks reaksi elemen (projected 3D -> 2D)
    │   └── ResultModal.tsx       # Skor akhir, Rank S/A/B/C, tombol Retry
    └── tests/
        ├── damageCalculator.test.ts
        ├── reactionSystem.test.ts
        └── playerFSM.test.ts
```

### 5.2. Kontrak Tipe Data Utama (`src/game/types/schema.ts`)

```typescript
export type ElementId = 'pyro' | 'volt' | 'aqua' | 'terra' | 'aero' | 'flora' | 'solar' | 'lunar' | 'umbra' | 'lux';
export type WeaponArchetype = 'FAST_MELEE' | 'HEAVY_MELEE' | 'POLEARM' | 'RANGED';
export type StatusEffectId = 'BURN' | 'SHOCK' | 'WET' | 'ROOT' | 'MARK';
export type FormTier = 'BASIC' | 'SUPER' | 'ULTIMATE';
export type EnemyTier = 'MINION' | 'ELITE' | 'MINI_BOSS' | 'BOSS';

export interface WeaponConfig {
  id: string;
  name: string;
  archetype: WeaponArchetype;
  baseDamage: number;
  comboMultipliers: [number, number, number];
  attackSpeed: number;
  hitStopMs: number;
  range: number;
  gaugePerHit: number;
  modelPath?: string; // Opsional di fase Greybox (fallback ke procedural mesh)
}

export interface PetConfig {
  id: string;
  name: string;
  passiveDescription: string;
  passiveBonus: { stat: 'atk' | 'speed' | 'gaugeGain' | 'regen'; value: number };
  assistCooldown: number;
  assistDamageMultiplier: number;
  appliesStatus: StatusEffectId;
  modelPath?: string;
}

export interface ElementConfig {
  id: ElementId;
  name: string;
  primaryColor: string;
  emissiveColor: string;
  statusApplied: StatusEffectId;
  weapon: WeaponConfig;
  pet: PetConfig;
  skill: {
    name: string;
    cooldown: number;
    damageMultiplier: number;
    radius: number;
  };
  finisherName: string;
}

export interface EnemyConfig {
  id: string;
  name: string;
  tier: EnemyTier;
  maxHp: number;
  maxGuard: number; // 0 jika tidak punya Super Armor
  defense: number;
  moveSpeed: number;
  attackDamage: number;
  telegraphDurationSec: number;
  scale: number;
  color: string;
}
```

---

## 6. Rencana Pengembangan Bertahap (Execution Roadmap)

Setiap fase dirancang agar menghasilkan *playable build* yang bisa langsung dibuka dan diuji di browser. **Jangan lompat ke aset 3D detail sebelum Phase 1–3 terasa solid di mode Greybox.**

### Phase 0: Project Scaffolding & Core Engine Foundation
**Tujuan:** Menyiapkan fondasi Vite + TypeScript + Three.js + Rapier3D + React + Zustand + Vitest dengan *render loop* stabil $60\text{ FPS}$.

* [x] Inisialisasi proyek Vite (`react-ts`), instal `three`, `@types/three`, `@dimforge/rapier3d-compat`, `zustand`, `howler`, `tailwindcss`, `vitest`.
* [x] Bangun `GameApp.ts` dan `Loop.ts` dengan *fixed timestep* ($\Delta t = 1/60\text{ s}$) serta dukungan pengubah *time-scale* (untuk *hit-stop* dan *slow-motion*).
* [x] Integrasikan `PhysicsWorld.ts` (Rapier3D) dengan lantai arena silinder/oktagonal + dinding pembatas tak terlihat.
* [x] Buat `InputManager.ts` (WASD, Mouse Pointer Lock, klik serang/dodge, tombol `1/2/3/Q/E/F/Tab`) lengkap dengan *input buffer* ($150\text{ ms}$).
* [x] Pasang pencahayaan dasar (*DirectionalLight* + *HemisphereLight* + *Toon/Stylized lighting*) dan *FPS debug overlay* sederhana.

**Definition of Done (DoD):**
* Browser menampilkan arena 3D di $60\text{ FPS}$ tanpa *console error*.
* Kapsul pemain bisa bergerak di dalam arena dan berhenti di dinding batas tanpa tembus.

---

### Phase 1: Greybox Combat Feel & Lock-On Camera
**Tujuan:** Membuktikan *combat feel* terbaik menggunakan *primitive/procedural mesh* (Rider kapsul + helm + sabuk menyala + senjata blok geometris) melawan 1 *Training Dummy*.

* [x] Bangun `CameraRig.ts`: kamera *third-person* halus, *collision clamp* agar tidak menembus lantai, fitur *Lock-On*, dan *camera shake*.
* [x] Implementasi `PlayerRider.ts` dengan FSM lengkap (`IDLE`, `MOVE`, `ATTACK_1/2/3`, `DODGE`, `HITSTUN`).
* [x] Implementasi `HitboxSystem.ts` dan `DamageCalculator.ts` + tulis unit test di `damageCalculator.test.ts`.
* [x] Tambahkan mekanik *Hit-Stop*, *Dodge i-frames* ($0.25\text{ detik}$), dan deteksi *Perfect Dodge* (memicu *slow-mo* $0.25\times$).
* [x] Buat `SlashTrail.ts` (jejak ayunan senjata) dan *floating damage numbers* pada `DamageNumbers.tsx`.
* [x] Buat *procedural audio synth* di `AudioManager.ts` untuk bunyi ayunan, pukulan, dan *dodge* agar *feedback* langsung terasa.

**Definition of Done (DoD):**
* Kombo 3-hit terhadap *dummy* terasa responsif dengan *hit-stop*, *slash trail*, angka *damage*, dan *camera shake*.
* `npm run test` lulus $100\%$ untuk `DamageCalculator`.

---

### Phase 2: Sistem 3 Elemen, Reaksi Kombo & Pet Assist
**Tujuan:** Menghidupkan identitas utama game—ganti Gem *on-the-fly* antara Api, Petir, dan Air beserta senjata, reaksi elemen, dan *Pet*.

* [x] Buat `src/game/data/elements.ts` untuk `pyro` (Greatsword + Phoenix), `volt` (Dual Dagger + Raiju), dan `aqua` (Trident + Leviathan).
* [x] Implementasi tombol `1 / 2 / 3` (*Form Switch* dengan *animation cancel*): warna armor/sabuk berubah dinamis, mesh senjata di tangan berganti, dan stat serangan mengikuti elemen aktif.
* [x] Bangun `ReactionSystem.ts` (`WET+VOLT`, `WET+PYRO`, `BURN+VOLT`) beserta unit test di `reactionSystem.test.ts`.
* [x] Implementasi Skill Elemen (`Q`) dengan *cooldown* terpisah per elemen dan efek VFX dari `ParticlePool.ts`.
* [x] Implementasi `PetEntity.ts` (`E`): *Pet* muncul di samping Rider dengan efek partikel, melakukan serangan *assist* (memberi status elemen), lalu menghilang, sekaligus mengaktifkan *buff* pasifnya.
* [x] Bangun `CombatHUD.tsx`: HP Bar, slot 3 Gem dengan indikator *cooldown*, status aktif, dan notifikasi teks reaksi elemen (*"STEAM BURST!"*, *"ELECTRO-SURGE!"*).

**Definition of Done (DoD):**
* Pemain bisa menerapkan status `WET` dengan Air, lalu menekan `2` (Petir) di tengah kombo untuk langsung memicu ledakan *Electro-Surge*.
* Semua 3 Pet dapat dipanggil tanpa menurunkan *frame rate* (menggunakan *object pooling*).

---

### Phase 3: Wave System, 3 Tier Monster & Henshin Evolution (Super & Ultimate)
**Tujuan:** Menyelesaikan *full playable vertical slice* dari Wave 1 hingga mengalahkan Boss dengan *Ultimate Finisher*.

* [x] Implementasi `EnemyBase.ts`: AI kejar/serang, indikator *telegraph* merah ($0.5\text{ detik}$), *Guard Bar* (*Super Armor*) untuk Elite, dan status *Staggered*.
* [x] Implementasi `BossKaijin.ts`: 2 Fase pertempuran (transisi aura & pola serangan baru saat HP $< 50\%$) serta *Boss HP & Stagger Bar* di HUD.
* [x] Implementasi `StageManager.ts` untuk alur 3 Wave berurutan + drop *Gem Shard* dari musuh yang mati.
* [x] Bangun sistem **Driver Gauge** dan **Super Form** (`F`): gelombang dorong area, kemunculan *modular armor pieces* (bahu/sayap/aura) pada model Rider, dan peningkatan stat.
* [x] Bangun sistem **Ultimate Form & Finisher** (`F` saat Overdrive penuh): *camera timeline* sinematik $3.5\text{ detik}$, memunculkan *Pet* skala besar di belakang Rider, melancarkan serangan gabungan, dan ledakan penutup.
* [x] Buat `LoadoutHub.tsx` (layar awal pilih urutan 3 Gem + pratinjau 3D) dan `ResultModal.tsx` (Rank `S/A/B/C` + simpan rekor di `localStorage`).

**Definition of Done (DoD):**
* Sesi permainan penuh (Hub -> Henshin -> Wave 1 -> Wave 2 -> Boss -> Ultimate Finisher -> Result -> Replay) berjalan mulus tanpa *softlock* atau *memory leak*.

---

### Phase 4: Integrasi Aset 3D, Cel-Shading, SFX Tokusatsu & Optimasi Web
**Tujuan:** Mengganti *greybox* menjadi visual *stylized* yang memukau sambil menjaga anggaran performa web.

* [x] Siapkan/integrasikan *Shared Rig* karakter Rider (`.glb` + Draco) dengan *bone sockets* (`RightHand`, `LeftHand`, `ChestArmor`, `ShoulderL/R`, `BackWing`) dan 3 set animasi dasar (Fast, Heavy, Polearm).
* [x] Ganti model senjata, 3 *Pet*, 3 tier musuh, dan *props* arena dengan aset `.glb` terkompresi (target segitiga: Rider $< 12\text{k}$, Pet $< 5\text{k}$, Minion $< 4\text{k}$, Boss $< 15\text{k}$).
* [x] Terapkan material *MeshToonMaterial* / *Custom Cel-Shader* dengan *outline* tipis dan *emissive glow* pada visor helm serta sabuk Driver.
* [x] Masukkan SFX khas Tokusatsu: klik sabuk, gemerincing Gem, *jingle* singkat *Henshin*, suara tebasan per elemen, dan BGM tempur dinamis (berubah intensitas di Wave Boss).
* [x] Audit optimasi: pastikan tidak ada alokasi `new THREE.Vector3()` di dalam `update()` loop, aktifkan `dispose()` saat pindah layar, dan verifikasi total *network payload* $< 25\text{ MB}$.

**Definition of Done (DoD):**
* Loading awal $< 8\text{ detik}$, memori stabil saat *replay* 3 kali berturut-turut, dan FPS tetap $\ge 55\text{--}60$ saat efek *Ultimate Finisher* aktif.

---

### Phase 5: Ekspansi Konten (Post-MVP Scaling)
**Tujuan:** Menambah kedalaman konten setelah fondasi MVP terbukti seru dimainkan.

* [ ] Tambahkan 7 elemen lanjutan (Terra, Aero, Flora, Solar, Lunar, Umbra, Lux) beserta archetype `RANGED` (Panah & Gun).
* [ ] Tambahkan 2 Arena tematik baru (Kawah Vulkanik, Reruntuhan Hutan) dengan *lazy loading* per stage.
* [ ] Sistem koleksi & *unlock* Gem/Pet dari *drop* Boss serta peningkatan level Gem di Hub.
* [ ] Dukungan *Gamepad Controller* (Gamepad API) untuk pengalaman *action* ala konsol di browser.

---

## 7. Panduan Eksekusi di Google Antigravity + Gemini 4 Neon

Agar pengembangan bersama **Gemini 4 Neon** di Antigravity berjalan cepat, akurat, dan hemat kuota token, ikuti alur kerja berikut:

### 7.1. Pengaturan Reasoning Level Gemini 4 Neon
* **Thinking Level `High` / `Extra High`:** Gunakan saat memulai arsitektur fase baru (Phase 0, 1, 3), menyusun *hitbox/physics* Rapier3D, merancang *CameraRig* sinematik, atau memecahkan *bug* performa WebGL.
* **Thinking Level `Medium`:** Ideal untuk pembuatan konfigurasi elemen (`elements.ts`), komponen React HUD (`CombatHUD.tsx`), styling Tailwind, dan penulisan unit test Vitest.
* **Orchestrator (Neon + Hydrogen):** Aktifkan saat menjalankan tugas repetitif lintas banyak file (misalnya menambahkan 7 elemen baru di Phase 5 atau *refactor* penamaan aset).

### 7.2. Siklus Kerja Per Fase di Antigravity
1. **Awali dengan `/plan`:** Minta Gemini 4 Neon membaca `GAME_DESIGN_AND_PLAN.md` dan membuat *Implementation Plan* khusus untuk **1 fase saja** (jangan minta mengerjakan Phase 0 sampai Phase 4 dalam satu prompt).
2. **Eksekusi Bertahap & Automated Test:** Pastikan agen selalu menjalankan `npm run typecheck` dan `npm run test` sebelum menandai sebuah task selesai.
3. **Verifikasi Visual dengan Antigravity Built-in Browser:** Setelah setiap fase selesai, minta agen menjalankan `npm run dev`, membuka aplikasi di *Built-in Browser* Antigravity, memeriksa *console error*, menguji interaksi tombol (`1/2/3`, serang, dodge, transformasi), dan merekam/mengambil tangkapan layar HUD serta arena 3D untuk kamu tinjau.
4. **Update Checklist:** Minta agen mencentang `[x]` pada dokumen ini setelah sebuah task terverifikasi.

### 7.3. Contoh Prompt Starter untuk Phase 0 di Antigravity
> *"Baca `GEMINI.md` dan `GAME_DESIGN_AND_PLAN.md`. Kita akan memulai **Phase 0: Project Scaffolding & Core Engine Foundation**. Buat implementation plan terlebih dahulu sebelum menulis kode. Pastikan TypeScript strict aktif, integrasikan Three.js + Rapier3D dengan fixed timestep 60Hz, siapkan arena greybox dengan kapsul player yang bisa bergerak (WASD), dan verifikasi hasilnya di browser tanpa console error."*
