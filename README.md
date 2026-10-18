# Dashboard monitoring fermentasi

HTML, CSS, dan JavaScript murni tanpa framework/build step. Chart.js dimuat
dari CDN sehingga grafik membutuhkan internet. Semua waktu dashboard memakai WIB.

## File

- index.html: tampilan dashboard.
- style.css: tema otomatis dan tata letak responsif.
- app.js: dialog koneksi lokal, polling, delapan grafik, tabel dan ekspor CSV.
- config.js: pengaturan polling dan FERM_START_DATE opsional; tanpa URL/kunci.
- Code.gs: endpoint baca berkunci, GET ESP lama, dan POST batch CSV.
- manifest.webmanifest dan sw.js: pemasangan PWA dan cache file statis.
- icon-192.png dan icon-512.png: ikon PWA yang harus disediakan, tanpa dibuat ulang.

## Siapkan sheet dan deploy Apps Script

1. Buka spreadsheet yang digunakan ESP32-S3. Cadangkan script lama.
2. Pastikan baris pertama adalah header dengan urutan 11 kolom berikut:

   Waktu | Suhu DS18B20 (C) | MQ3 (Rs/R0) | pH Tanah | CO2 (ppm) |
   Suhu SCD40 (C) | RH (%) | Setpoint (C) | u (-100..100) |
   Duty Lampu (%) | Kipas (%)

3. Kolom Waktu harus berisi tanggal Google Sheets, bukan teks tanggal.
4. Atur zona waktu spreadsheet pada File > Settings ke Jakarta / GMT+07:00.
5. Buka Extensions > Apps Script, lalu masukkan isi Code.gs.
6. Sesuaikan SHEET_NAME dengan nama tab lama yang dipakai ESP (bawaan: Data).
   Di editor Apps Script, ganti READ_KEY dari placeholder GANTI_KUNCI_ANDA
   dengan kunci akses pilihan Anda. Simpan kunci sebenarnya hanya di Apps Script
   dan masukkan lewat dialog dashboard; jangan menyalinnya ke file proyek/repository.
7. Atur zona waktu project Apps Script ke Asia/Jakarta.
8. Pilih Deploy > New deployment > Web app.
9. Pilih Execute as: Me dan Who has access: Anyone.
10. Berikan otorisasi Google dan salin URL deployment yang berakhiran /exec.
11. Buka dashboard, ketik URL deployment dan kunci akses pada dialog, lalu pilih Simpan dan masuk.

Untuk mempertahankan URL yang dipakai ESP, perbarui deployment lama melalui
Deploy > Manage deployments > Edit > New version > Deploy.
Jika membuat deployment baru, ubah URL pada ESP dan masukkan ulang melalui dialog dashboard.
Jangan memakai URL /dev. Jika organisasi melarang Anyone, administrator perlu
mengizinkan akses tersebut.

## Jalankan web

Dari folder proyek jalankan:

```sh
python -m http.server 8000
```

Buka http://localhost:8000. Untuk GitHub Pages, unggah file proyek ke repository,
lalu aktifkan Settings > Pages dan pilih branch/folder sumber.
Tidak diperlukan instalasi dependensi atau build.

## GET baca

```text
https://script.google.com/macros/s/ISI_ID_ANDA/exec?action=read&key=GANTI_KUNCI_ANDA&limit=200
```

```json
{"rows":[["2026-10-17T03:00:00.000Z",40.2,null,6.5,1500,39.8,80,42,25,25,0]]}
```

Endpoint baca memerlukan parameter key yang sama dengan READ_KEY. Kunci salah
atau tidak ada dibalas {"error":"unauthorized"}, tanpa membaca sheet. Jalur GET
ESP tanpa action dan POST tetap tanpa kunci.

Default limit adalah 200; batas maksimum 10000. Endpoint mengembalikan N baris
terakhir sheet tanpa header. Sel sensor kosong/bukan angka menjadi null.
Tanggal dikirim dalam ISO UTC. Waktu tidak valid menjadi null; dashboard
mengabaikan baris tersebut. Error dibalas sebagai JSON dengan properti error.

READ_LIMIT dashboard bawaan adalah 10000. Pilihan 1/6/24 jam memfilter data
yang sudah dimuat berdasarkan waktu sekarang. Grafik tidak mengambil tambahan
baris di luar READ_LIMIT. Cakupan data tersedia ditampilkan di atas grafik.

Pada interval kiriman 15 detik, 24 jam membutuhkan 5760 baris.
Pada interval 5 detik, 24 jam membutuhkan 17280 baris. Bila perlu lebih dari
10000 baris, ubah MAX_READ_LIMIT di Code.gs dan READ_LIMIT di config.js,
dengan memperhatikan ukuran respons serta kuota Apps Script.

## GET ESP lama

```text
https://script.google.com/macros/s/ISI_ID_ANDA/exec?suhu=40.2&mq3=1.3&ph=6.5&co2=1500&suhuscd=39.8&rh=80&sp=42&u=25&lamp=25&fan=0
```

Menyimpan satu baris dengan waktu penerimaan server dan membalas teks OK.
Urutan sensor tetap sama. Parameter kosong/tidak ada/bukan angka menjadi
sel kosong. Pembukaan URL tanpa parameter sensor tidak membuat baris kosong.
Jangan kirim angka 0 sebagai pengganti sensor error jika ingin menampilkan --.

## POST batch CSV

Gunakan Content-Type: text/plain dan body CSV tanpa header:

```csv
1792206000,40.2,1.3,6.5,1500,39.8,80,42,25,25,0
1792206015,40.3,,6.5,1505,39.9,81,42,24,24,0
```

Urutan: epoch,suhu,mq3,ph,co2,suhuscd,rh,sp,u,lamp,fan.
Epoch menerima detik atau milidetik Unix. Tiap baris berisi tepat 11 kolom.
Kolom kosong dipertahankan; baris kosong diabaikan. Seluruh batch divalidasi
sebelum ditulis. Balasan sukses: OK. Balasan gagal: ERROR: penjelasan.
Jangan mengirim ulang batch sukses karena dapat menggandakan data.

## Status dan ekspor

- Polling 15 detik, timeout fetch 12 detik.
- OFFLINE jika data terbaru lebih tua dari 2 menit atau fetch gagal.
- Data sebelumnya tetap terlihat saat fetch gagal, disertai banner error.
- Status suhu/kontrol offline diberi keterangan DATA TERAKHIR.
- OVERTEMP jika DS18B20 >= 52 C atau SCD40 >= 55 C.
- PEMANAS jika u > 0.5, PENDINGIN jika u < -0.5, selain itu IDLE.
- Deadband dapat diubah melalui CONTROL_DEADBAND.
- Sel sensor kosong ditampilkan -- dan memutus garis grafik.
- Tabel menampilkan 50 data terbaru; CSV berisi semua data yang dimuat.
- Waktu CSV memakai offset +07:00 dan sel sensor kosong tetap kosong.
- Tema hangat mengikuti sistem secara default; tombol tema memilih gelap/terang
  dan menyimpan pilihan manual di browser. Hapus preferensi fermentasi-theme
  pada localStorage untuk kembali mengikuti sistem.

## Panel dashboard

Font Fraunces digunakan untuk judul dan Nunito untuk teks, angka, tabel serta grafik.
Logo sidebar menggunakan img: logo.svg untuk gelap, logo-light.svg untuk terang,
dan logo-icon.svg saat diciutkan serta untuk favicon. Ketiga file SVG harus
berada di folder yang sama dengan index.html.

- Sidebar dapat diciutkan di desktop dan dibuka sebagai menu geser di HP.
- Header memuat rentang 1 jam, 6 jam, 24 jam, 5 hari, Sesi terakhir, atau Semua.
- Sesi terakhir dimulai setelah celah terakhir yang lebih dari 10 menit.
  Pilihan ini otomatis aktif jika data terbaru lebih dari satu jam yang lalu,
  sampai pengguna memilih rentang sendiri. Sesi berlaku pada data yang dimuat.
- Grafik memutus garis pada celah lebih dari dua menit atau nilai kosong.
  Titik terisolasi ditampilkan dengan radius 3 px; titik tersambung hanya terlihat saat hover.
- Sumbu X memakai batas waktu data dalam rentang aktif. Untuk satu waktu unik,
  jendela dua detik digunakan agar skala tidak melebar secara otomatis.
- Grafik dengan kurang dari dua pengukuran sensor valid menampilkan pesan
  "Data belum cukup untuk grafik". Titik tunggal tetap digambar.
- Semua rentang memakai data yang telah dimuat, tetap dibatasi READ_LIMIT.
- Status Board selalu menampilkan nilai terkini; tren membandingkan pengukuran
  terakhir pada rentang dengan titik sekitar 5 menit sebelumnya (toleransi 2 menit).
  Bila pembanding atau nilai sensor kosong, tren tampil --.
- Sparkline memakai maksimal 120 titik dari 30 menit terakhir pada rentang terpilih.
- Ringkasan Harian memakai seluruh data asli yang dimuat untuk sepuluh parameter,
  tanpa mengikuti rentang grafik. Rincian perhitungan dijelaskan di bawah.
- Tombol perbesar panel dapat dibatalkan dengan tombol yang sama atau Escape.
- Tombol unduh setiap grafik mengekspor parameter dan data rentang terpilih.
  Ringkasan Harian mengekspor statistik per hari dari seluruh data yang dimuat;
  Status Board mengekspor seluruh parameter pada rentang.
- Tabel tetap berisi 50 data terbaru tanpa filter rentang, dan kedua tombol CSV
  pada panel tabel tetap mengekspor seluruh data yang dimuat seperti sebelumnya.

## Ringkasan Harian

- Setiap baris mewakili tanggal kalender WIB (UTC+7) yang mempunyai data.
- Rata-rata, minimum, maksimum, dan jumlah data valid dihitung terpisah untuk
  DS18B20, SCD40, RH, CO2, MQ3, pH tanah, Setpoint, u, Duty Lampu, dan Kipas.
  Sel kosong diabaikan; angka nol tetap merupakan pengukuran valid.
- Tombol Rata-rata, Minimum, Maksimum, atau Jumlah data hanya mengganti tampilan
  tabel harian. Grafik dan tabel 50 data terbaru tidak ikut berubah.
- Baris Seluruh periode menghitung statistik langsung dari pengukuran valid,
  bukan rata-rata dari rata-rata harian.
- FERM_START_DATE di config.js kosong secara default, sehingga tanggal data
  pertama yang dimuat adalah hari ke-1. Isi misalnya '2026-10-20' untuk memakai
  tanggal mulai tertentu. Tanggal sebelum tanggal tersebut ditandai praproses
  tanpa nomor. Nomor hari mengikuti selisih tanggal kalender, termasuk hari
  yang tidak memiliki data. Tanggal konfigurasi tidak valid diabaikan dengan
  penjelasan pada panel.
- Hari pertama yang dimuat, hari berjalan, atau hari dengan kurang dari
  4608 kiriman (80% dari 5760 kiriman/hari pada interval 15 detik) diberi label
  sebagian. Jumlah valid setiap sensor tetap dapat diperiksa lewat Jumlah data.
- Ringkasan terbatas pada READ_LIMIT yang berhasil dimuat dari sheet. Data
  yang berada di luar batas tersebut tidak ikut dihitung atau diekspor.
- Unduh CSV Harian menghasilkan satu baris per tanggal dengan hari ke-N,
  tanggal WIB, label kelengkapan, jumlah kiriman, serta rata-rata/min/maks/n
  untuk setiap parameter. Pemisah koma dan tanda desimal titik.
- Unduh CSV (Excel Indonesia) berisi statistik yang sama dengan pemisah titik
  koma dan tanda desimal koma. Keduanya menyertakan BOM UTF-8, nilai kosong
  tetap kosong, dan jumlah data valid ditulis nol jika tidak ada pengukuran.

## Pemeriksaan setelah deploy

1. Buka dashboard dan isi URL + kunci. Pastikan data termuat; kunci salah membuka dialog lagi.
2. Kirim GET ESP: periksa satu baris baru dan balasan OK.
3. Kirim dua baris CSV: periksa dua baris baru dan balasan OK.
4. Kosongkan satu nilai sensor: periksa -- dan celah grafik.
5. Uji DS18B20=52 atau SCD40=55: periksa OVERTEMP.
6. Hentikan kiriman ESP lebih dari dua menit: periksa OFFLINE.
7. Putus internet: periksa banner dan data lama tetap terlihat.
8. Periksa rentang grafik, tema, tampilan HP, tabel dan unduh CSV.

## Pengaturan koneksi di browser

Pada kunjungan pertama, isi URL Web App yang diawali
https://script.google.com/macros/s/ dan berakhiran /exec. Contoh placeholder:
https://script.google.com/macros/s/ISI_ID_ANDA/exec.

Masukkan kunci yang sama dengan READ_KEY di editor Apps Script. Setelah Simpan
dan masuk, pengaturan disimpan pada localStorage browser dengan nama fk_url
dan fk_key. Kunjungan berikutnya memakai pengaturan tersebut. Setiap perangkat,
profil browser, atau origin website mempunyai penyimpanan terpisah.

Dashboard tidak meminta data atau membuat grafik sebelum kedua isian lengkap
dan server menerima kunci. Respons unauthorized membuka dialog lagi dan
menghapus kunci yang ditolak. Bila URL/deployment salah atau penyimpanan lokal
tidak tersedia, dialog menampilkan penjelasan.

Tombol Keluar dan hapus pengaturan di sidebar menghapus fk_url dan fk_key,
membatalkan permintaan aktif, dan membersihkan data yang sedang terlihat.
Pilihan tema tetap tersimpan. URL dan kunci tidak ditulis ke file proyek atau
Cache Storage service worker. Jangan menyimpan kredensial dalam repository.

READ_KEY melindungi pembacaan; jalur kirim ESP GET/POST tetap terbuka sesuai
alur sebelumnya. Kunci disimpan di browser perangkat dan dikirim melalui HTTPS
sebagai parameter key, sehingga perangkat/browser tersebut perlu dipercaya.
Jangan membagikan URL permintaan lengkap yang menyertakan kunci.

## Pasang ke layar utama HP (PWA)

1. Letakkan icon-192.png (192×192) dan icon-512.png (512×512) di folder yang
   sama dengan index.html. Gunakan ikon yang sudah disediakan; jangan menggantinya
   dengan placeholder. Logo SVG tetap memakai berkas yang sama seperti sebelumnya.
2. Publikasikan dashboard melalui HTTPS, misalnya GitHub Pages. Untuk uji lokal
   gunakan http://localhost:8000; akses HTTP melalui alamat IP LAN HP tidak
   menyediakan service worker. Membuka file langsung juga tidak mengaktifkan PWA.
3. Buka website dan isi URL + kunci sekali pada browser tersebut.
4. Android Chrome: menu browser > Instal aplikasi atau Tambahkan ke layar utama.
5. iPhone/iPad Safari: Bagikan > Tambah ke Layar Utama, lalu Tambah.
6. Buka lewat ikon FermentorKakao. Jika browser memisahkan penyimpanan aplikasi
   terpasang dari tab, masukkan URL + kunci sekali lagi di aplikasi tersebut.

Manifest memakai path relatif agar dapat dipasang dari subfolder GitHub Pages.
Nama aplikasi FermentorKakao dan tampilan standalone. Service worker memakai
network-first: mengambil file statis terbaru dahulu dan memakai cache saat
jaringan gagal. File/aset yang belum ada tidak membuat instalasi shell gagal,
tetapi kedua ikon PNG tetap diperlukan untuk pemasangan PWA yang lengkap.

Service worker hanya menyimpan file statis dashboard yang diizinkan secara
eksplisit. Permintaan Apps Script, redirect Google, permintaan berkunci/query,
data sensor, serta file Code.gs tidak di-cache. Fonts dan Chart.js dari CDN
juga tidak disimpan oleh service worker ini. Cache membantu membuka antarmuka
saat offline; data baru dan dependensi CDN tetap memerlukan internet.

Saat mengubah strategi/cache aplikasi, naikkan versi CACHE_NAME di sw.js.
Versi cache lama milik dashboard ini dibersihkan ketika worker baru aktif.

Jika fetch gagal, periksa URL /exec, READ_KEY, deployment Anyone, koneksi
internet, dan pastikan endpoint mengembalikan JSON, bukan halaman login Google.
