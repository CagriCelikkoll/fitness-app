# Fitness App v0.2 — Antrenman Akışı Patch'i

Bu zip, mevcut projene **ekleme/üzerine yazma** olarak uygulanır.
Hiçbir dosya silinmesi gerekmiyor — sadece var olanlar güncelleniyor ve
yeni dosyalar ekleniyor.

## Yeni / Değişen Dosyalar

### Değişen
- `package.json` — `expo-haptics` ve `react-native-worklets` eklendi
- `babel.config.js` — `react-native-worklets/plugin` son sıraya eklendi
  (zaten Claude Code eklemişti, yine de patch ile gönderiyorum)
- `app/_layout.tsx` — yeni route'lar (routine/new, session/active) eklendi
- `app/(tabs)/index.tsx` — ana sayfa: aktif antrenman bandı + son antrenmanlar
- `app/(tabs)/workout.tsx` — placeholder'dan gerçek rutin listesine dönüştü

### Yeni
- `app/routine/new.tsx` — Yeni rutin oluşturma ekranı
- `app/session/active.tsx` — Aktif antrenman ekranı (set loglama)
- `src/components/ExercisePickerModal.tsx` — Egzersiz seçici modal
- `src/components/RestTimer.tsx` — Dinlenme zamanlayıcısı (haptic'li)
- `src/lib/lastSession.ts` — Auto-fill için son seans sorgusu
- `src/stores/activeWorkoutStore.ts` — Zustand store

## Uygulama Adımları

1. Bu zip'i **mevcut proje klasörünün üstüne aç**:
   ```
   C:\Users\Çağrı\Downloads\fitness-app\fitness-app\
   ```
   (`fitness-v0.2-patch` içeriği `fitness-app` klasörüne kopyalansın,
   yani `app/`, `src/`, `package.json`, vs. doğrudan kök dizine gelsin.)

2. Yeni paketleri kur:
   ```
   npm install --legacy-peer-deps
   ```
   (`expo-haptics` ve `react-native-worklets` yüklenir; zaten varsa noop.)

3. TypeScript kontrol:
   ```
   npm run type-check
   ```
   Sıfır hata beklenmeli.

4. Metro'yu yeniden başlat:
   ```
   npx expo start --tunnel --clear
   ```
   `--clear` cache'i temizler, yeni route'ların tanınması için önemli.

5. Expo Go'da QR'ı tara, uygulamayı aç.

## Ne Bekleyebilirsin

### Ana sayfa
- Üstte aktif antrenman bandı (varsa)
- 3 istatistik kartı: Egzersiz / Rutin / Antrenman sayıları
- "Antrenmana Başla" kartı
- Son 3 tamamlanmış antrenman

### Antrenman tab'ı
- İlk açılışta boş state: "İlk Rutini Oluştur" butonu
- Rutin oluşturduktan sonra: kart listesi, sağ altta `+` FAB
- Her rutin kartında: "Antrenmanı Başlat" butonu, "Sil" ikonu

### Yeni Rutin ekranı
- İsim + açıklama
- "Egzersiz Ekle" → modal açılır, çoklu seçim yap
- Her egzersize set/tekrar/ağırlık/dinlenme hedefi gir
- Cardio için: süre alanı (saniye)
- "Kaydet" → routines + routine_exercises tablolarına yazılır

### Aktif Antrenman ekranı
- Üstte: önceki/sonraki egzersiz nav + sayaç (3/8 gibi)
- Set listesi:
  - Set numarası | ÖNCEKİ | KG | TEKRAR | ✓
  - "ÖNCEKİ" sütunu: son seansta o sette ne yapmıştın
  - KG / TEKRAR placeholder'larında da son seans değerleri (auto-fill ipucu)
  - ✓ butonuna basınca: set tamamlanır, dinlenme timer başlar (haptic + geri sayım)
- Set Ekle butonu (planlanandan fazla set yapacaksan)
- Altta "Antrenmanı Bitir" butonu

### Dinlenme Timer
- Set tamamlanınca otomatik başlar (rutinden gelen rest süresi ile)
- Ekranın altında bant olarak görünür
- Geri sayım + ilerleme çubuğu
- +15sn / -15sn / X (iptal) butonları
- Bitince haptic feedback (success notification)
- 3 saniye sonra otomatik kapanır

## Veri Modeli Notu

Bu güncellemede şema **değişmedi**, mevcut veritabanın olduğu gibi kullanılabilir.
Sadece var olan tablolara yeni satırlar yazılıyor:
- `routines` ← yeni rutin
- `routine_exercises` ← rutindeki egzersizler ve hedefler
- `workout_sessions` ← yeni session
- `session_exercises` ← seanstaki egzersizler
- `sets` ← her bir set

## Test Önerisi

1. Yeni rutin oluştur: "Push Day" → Bench Press, Shoulder Press, Tricep gibi 3-4 hareket ekle
2. Her birine 3-4 set, 8-12 tekrar, 90 sn dinlenme ata
3. Kaydet → Antrenman tab'ında rutin görünür
4. "Antrenmanı Başlat" → aktif ekran açılır
5. İlk set için ağırlık + tekrar gir, ✓'ya bas → timer başlar
6. Tüm setleri bitirip "Antrenmanı Bitir" → ana sayfada görünmeli
7. **İkinci kez aynı rutini başlat** → bu sefer "ÖNCEKİ" sütunu dolu olacak ve placeholder'larda son değerler görünecek. **Bu auto-fill'in çalışması demek.**

## Henüz Yok (sonraki iterasyonda)

- Rutin **düzenleme** (şimdilik sil ve yeniden oluştur)
- Egzersiz **sıralamasını** sürükle-bırak ile değiştirme
- **Superset** UI (data model destekliyor ama UI yok)
- **Antrenman geçmişi** detay sayfası
- **Background bildirim** rest timer için (uygulama arka plandayken sesli uyarı)
- **Grafikler** (ilerleme tab'ı hala placeholder)
- **Vücut ağırlığı / ölçüm** girişi
