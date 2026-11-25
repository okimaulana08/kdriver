# Panduan Integrasi Model 3D Organik (Opsi A: Tripo3D / Meshy.ai + Mixamo)

Engine **Project K-DRIVER (Phase 4.5)** sudah dilengkapi pipeline **Hybrid Skeletal Animation (`SkeletalAnimator` + `SkeletonUtils.clone` + Auto Bone-Socket Mounting)** serta **PBR Material Preservation**. Artinya, begitu kamu mengonversi gambar *concept art* T-Pose menjadi model `.glb` organik dan *rig* tulang Mixamo, kamu cukup menaruh file `.glb` tersebut di folder `public/assets/models/custom/` — **tanpa perlu mengubah satu baris kode pun!**

---

## 1. File Concept Art T-Pose Siap Pakai
Gunakan 4 gambar A/T-Pose fotorealistis yang sudah di-generate di folder `docs/concept-art/`:
- `docs/concept-art/rider_tpose_sheet.jpg` — Kamen Rider utama bergaya live-action Kuuga.
- `docs/concept-art/kaijin_grunt_tpose.jpg` — Minion Kaijin Grunt (Wave 1–2).
- `docs/concept-art/kaijin_brute_tpose.jpg` — Elite Goliath Kaijin Brute (Wave 2).
- `docs/concept-art/kaijin_boss_tpose.jpg` — Final Boss Overlord Obsidian Kaijin (Wave 3).

---

## 2. Langkah Konversi: Gambar → 3D Organik → Animasi Mixamo

### Langkah A — Generate Mesh 3D PBR (Tripo3D / Meshy.ai)
1. Buka **Tripo3D** (`tripo3d.ai`) atau **Meshy.ai** (`meshy.ai`) → pilih **Image to 3D**.
2. Upload gambar T-Pose dari `docs/concept-art/` (`kaijin_grunt_tpose.jpg`, `kaijin_boss_tpose.jpg`, dll.).
3. Aktifkan **PBR Textures** (Albedo + Normal + Roughness/Metallic).
4. Set target poligon (Retopology / Polycount):
   - Rider: **8.000 – 12.000 triangles**
   - Minion / Elite: **4.000 – 6.000 triangles**
   - Boss: **10.000 – 15.000 triangles**
5. Export sebagai **`.fbx`** (untuk masuk ke Mixamo) atau `.glb`.

### Langkah B — Auto-Rig & Ambil Animasi di Mixamo (`mixamo.com`)
1. Upload file `.fbx` karakter ke **Mixamo.com** (100% gratis dengan akun Adobe).
2. Letakkan titik *Auto-Rigger* (Chin, Wrists, Elbows, Knees, Groin) — pilih Skeleton **Standard (65 bones)**.
3. Download **1 file karakter utama (`With Skin`)** dalam format FBX/GLB, misalnya `Idle` atau `T-Pose`.
4. Download animasi tempur favoritmu (**`Without Skin`**, 30 FPS, **In Place** dicentang untuk gerakan lari/attack):
   - `idle`: *Sword And Shield Idle* / *Fighting Idle*
   - `move`: *Sword And Shield Run* (centang **In Place**)
   - `attack1`: *Great Sword Slash* / *Sword And Shield Slash*
   - `attack2`: *Sword And Shield Slash (2)* / *Horizontal Slash*
   - `attack3`: *Great Sword High Spin Attack* / *Jump Attack*
   - `dodge`: *Stand To Roll* / *Sprinting Forward Roll* (centang **In Place**)
   - `skill`: *Great Sword Power Up* / *Spinning Kick*
   - `hitstun`: *Standing React Large From Front*
   - `henshin`: *Taunt* / *Power Up*
   - `ultimate`: *Great Sword Casting* / *Flying Bicycle Kick*
   - `death`: *Standing Death Backward 01*
5. Konversi `.fbx` ke `.glb` di **Blender** (File → Import FBX → Export glTF 2.0 `.glb` dengan centang **Compression / Draco** agar ukuran tiap file hanya ~`1.5 – 2.5 MB`!).
   - Kamu bisa menggabungkan seluruh *Action* ke dalam **1 file `rider.glb`**, **ATAU** mengekspor sebagai file `.glb` terpisah per animasi (`rider_base.glb`, `anim_idle.glb`, `anim_run.glb`, dll.) — engine mendukung keduanya!

---

## 3. Pasang ke Project K-DRIVER (`manifest.json`)
1. Salin file `.glb` ke folder:
   `public/assets/models/custom/`
2. Edit [manifest.json](../public/assets/models/custom/manifest.json):
   ```json
   {
     "rider": {
       "modelUrl": "/assets/models/custom/rider.glb",
       "targetHeightMeters": 1.84,
       "animationUrls": {
         "idle": "/assets/models/custom/anim_idle.glb",
         "move": "/assets/models/custom/anim_run.glb",
         "attack1": "/assets/models/custom/anim_attack1.glb",
         "attack2": "/assets/models/custom/anim_attack2.glb",
         "attack3": "/assets/models/custom/anim_attack3.glb",
         "dodge": "/assets/models/custom/anim_dodge.glb",
         "hitstun": "/assets/models/custom/anim_hit.glb",
         "death": "/assets/models/custom/anim_death.glb"
       }
     }
   }
   ```
   *(Jika seluruh animasi sudah tertanam di dalam 1 file `rider.glb`, biarkan semua nilai di `animationUrls` tetap `null` — `SkeletalAnimator` otomatis mengenali nama clip di dalamnya!)*
3. Refresh `http://localhost:5173/` dan tekan **`F3`** (Debug Overlay):
   - Status **`Rider Rig`** otomatis berubah menjadi **`MIXAMO SKELETAL`**.
   - Tinggi karakter otomatis dinormalisasi ke `1.84m` dengan kaki tepat menapak lantai beton.
   - Senjata elemen (`weapon_pyro/volt/aqua`) dan sayap emas Super Form otomatis terpasang pada tulang `mixamorigRightHand`, `mixamorigLeftHand`, dan `mixamorigSpine2`!
   - Seluruh tekstur UV PBR dari Tripo3D/Meshy tetap dipertahankan utuh sambil menerima pantulan langit HDRI 360° dan cahaya matahari dinamis.

---

## 4. Tips Optimasi Ukuran File (`< 25 MB`)
Jika ukuran `.glb` dari Tripo3D/Blender masih besar (`> 5 MB`), kompres sekali jalan dengan `gltf-transform`:
```bash
npx @gltf-transform/cli optimize input.glb public/assets/models/custom/rider.glb --compress draco --texture-compress webp --texture-size 1024
```
Dengan Draco + WebP 1024px, satu karakter Rider berkualitas figur S.H.Figuarts biasanya hanya **`1.2 – 2.2 MB`**.
