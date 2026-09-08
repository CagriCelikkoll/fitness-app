# Fitness Tracker

Kişisel kullanım için React Native + Expo tabanlı fitness takip uygulaması.
Lokal-first mimari, offline çalışır, veri kullanıcının cihazında yaşar.

## Aşama 1 — Mevcut Durum

- ✅ 9 tablolu SQLite veri modeli (Drizzle ORM ile)
- ✅ Strength + cardio destekli birleşik şema
- ✅ Free Exercise DB entegrasyonu (~800 hareket + 9 manuel cardio modu)
- ✅ Egzersiz kütüphanesi ekranı (arama + kategori filtresi + canlı sorgu)
- ✅ Egzersiz detay sayfası (kaslar + talimatlar + görsel)
- ✅ Tab navigasyonu (Ana sayfa / Antrenman / Egzersizler / İlerleme / Ayarlar)
- ✅ Wearable entegrasyonu için bugünden hazır alanlar

### Sonraki adımlar (kısa vadede)

- ⏳ Antrenman rutini oluşturma akışı
- ⏳ Antrenman loglama ekranı (set/tekrar/ağırlık + dinlenme zamanlayıcısı)
- ⏳ "Bir önceki antrenman" auto-fill özelliği
- ⏳ Vücut ağırlığı/ölçüm girişi
- ⏳ Temel grafikler (1RM, hacim, kas grubu ısı haritası)

## Tech Stack

- **Framework**: Expo SDK 54 + React Native 0.81
- **Yönlendirme**: expo-router (file-based)
- **Veritabanı**: expo-sqlite + Drizzle ORM
- **State**: TanStack Query + Zustand
- **UI**: NativeWind v4 (Tailwind for RN)
- **İkonlar**: lucide-react-native
- **Tarih**: date-fns
- **i18n**: i18next + react-i18next (TR varsayılan)

## Kurulum

### Ön gereksinimler

- Node.js 20+ ve npm
- (Android için) Android Studio + Android emülatörü, **veya** fiziksel Android cihaz + [Expo Go uygulaması](https://expo.dev/go)
- (iOS için, opsiyonel) Mac + Xcode

### Adımlar

```bash
# 1. Bağımlılıkları yükle
npm install

# 2. Drizzle migration'larını üret (schema.ts'ten SQL üretir)
#    Yeni şema değişikliği yaptığında tekrar çalıştır.
npm run db:generate

# 3. Geliştirme sunucusunu başlat
npm start

# Veya doğrudan Android'de aç:
npm run android
```

İlk açılışta:
1. Migration'lar çalışır (~9 tablo oluşur)
2. Free Exercise DB internetten çekilir (~800 egzersiz, ~150KB)
3. Manuel cardio modları eklenir (9 mod)
4. `app_settings` tablosuna varsayılan satır eklenir

## Proje Yapısı

```
fitness-app/
├── app/                          # expo-router file-based routing
│   ├── _layout.tsx               # Root layout (SQLite + migrations + seed + providers)
│   ├── (tabs)/
│   │   ├── _layout.tsx           # Tab bar
│   │   ├── index.tsx             # Ana sayfa / dashboard
│   │   ├── workout.tsx           # Antrenman ekranı (placeholder)
│   │   ├── exercises.tsx         # ⭐ Egzersiz kütüphanesi (çalışan ekran)
│   │   ├── progress.tsx          # İlerleme (placeholder)
│   │   └── settings.tsx          # Ayarlar (placeholder)
│   └── exercise/[id].tsx         # Egzersiz detay
├── src/
│   ├── db/
│   │   ├── schema.ts             # ⭐ Drizzle şeması (9 tablo + ilişkiler + tipler)
│   │   ├── client.ts             # Drizzle client setup
│   │   └── seed.ts               # İlk açılış seed mantığı
│   ├── components/               # Paylaşılan UI (henüz boş)
│   ├── hooks/                    # Custom hooks (henüz boş)
│   ├── lib/
│   │   ├── id.ts                 # UUID üreticisi (expo-crypto)
│   │   └── exerciseImage.ts      # Egzersiz görsel URL builder
│   ├── stores/                   # Zustand stores (henüz boş)
│   └── i18n/                     # i18n setup (henüz boş)
├── assets/
│   ├── seed/
│   │   └── cardio-modes.json     # Manuel cardio mod tanımları
│   └── exercises/                # Core asset GIF/MP4'leri (sonra eklenecek)
├── drizzle/                      # Üretilen SQL migration dosyaları
│   ├── 0000_initial.sql          # ⭐ İlk migration
│   └── migrations.js             # Runtime'da kullanılan migration listesi
├── babel.config.js               # NativeWind preset + inline-import for .sql
├── metro.config.js               # NativeWind + .sql resolver
├── tailwind.config.js            # Tailwind teması (gym dark)
├── drizzle.config.ts             # Drizzle Kit config
├── global.css                    # Tailwind directive'leri
└── app.json                      # Expo config
```

## Geliştirme Komutları

| Komut | Açıklama |
|---|---|
| `npm start` | Expo dev sunucusunu başlat (QR kodu ile cihaza bağlan) |
| `npm run android` | Android emülatörde aç |
| `npm run ios` | iOS simülatörde aç (Mac gerekir) |
| `npm run db:generate` | Schema değişikliğinden sonra yeni migration üret |
| `npm run db:studio` | Drizzle Studio'yu aç (DB görselleştirici) |
| `npm run type-check` | TypeScript tip kontrolü |
| `npm run lint` | ESLint |

## Şema Değiştirmek

Yeni alan/tablo eklemek için:

1. `src/db/schema.ts`'i düzenle
2. `npm run db:generate` çalıştır → `drizzle/000X_description.sql` üretilir
3. Uygulamayı yeniden başlat → `useMigrations` hook'u yeni migration'ı runtime'da uygular
4. Eski veritabanını temizlemek istiyorsan: emülatörde uygulama verilerini sil veya `expo run:android --clear`

## Veri Modeli

Tam veri modeli dokümantasyonu (SQL DDL + ilişki diyagramı + örnek sorgular) için
ayrı dosyaya bakınız: `fitness-app-asama1-veri-modeli.md`.

## Lisans / Veri Kaynakları

- Egzersiz veritabanı: [Free Exercise DB](https://github.com/yuhonas/free-exercise-db)
  (Public Domain, ~800 hareket, GIF görselleri)
- Egzersiz görselleri ilk başta GitHub raw URL'lerinden çekilir, ileride
  Cloudflare R2 CDN'ine taşınacak
