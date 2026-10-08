import '../global.css';

import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '../drizzle/migrations';
import { DATABASE_NAME } from '@/db/client';
import { seedIfEmpty } from '@/db/seed';
import { useDb } from '@/hooks/useDb';
import { installRestNotifications } from '@/lib/restNative';
import { connectRestTimerPersistence } from '@/lib/sessionRecovery';
import { useActiveWorkoutStore } from '@/stores/activeWorkoutStore';
import { COLORS } from '@/theme';

// Dinlenme bildirimi: ön plan işleyicisi + sayaç dinleyicisi. İzin
// burada istenmiyor, ilk dinlenme başlarken soruluyor.
installRestNotifications();

// Dinlenme sayacı kv-store'a yazılıyor: uygulama arka planda kapatılırsa
// yarım antrenmanla birlikte geri gelsin (bkz. useSessionRecovery).
connectRestTimerPersistence(useActiveWorkoutStore, Storage, (err) =>
  console.warn('[SESSION-RECOVERY] Sayaç kaydedilemedi:', err)
);

// SQLiteProvider'ın açtığı bağlantı için başlangıç ayarları.
// foreign_keys bağlantı düzeyinde bir pragma ve SQLite'ta varsayılan
// KAPALI; açılmadığı sürece şemadaki onDelete cascade/set null kuralları
// hiç tetiklenmiyor. onInit, children render edilmeden — yani
// DatabaseInitializer'daki migration'lardan önce — çalışır.
const initDatabase = async (db: SQLiteDatabase) => {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const fk = await db.getFirstAsync<{ foreign_keys: number }>(
    'PRAGMA foreign_keys;'
  );
  console.log('[DB-INIT] foreign_keys =', fk?.foreign_keys);
};

// Referansları modül düzeyinde sabit tutuyoruz: SQLiteProvider bunları
// kendi effect'inin bağımlılığında kullanıyor, her render'da yeni nesne
// verirsek veritabanını kapatıp yeniden açıyor.
const SQLITE_OPTIONS = { enableChangeListener: true };

/**
 * Migrations'ları çalıştırır ve seed eder.
 * SQLiteProvider'ın içinde olması gerekir (useDb → useSQLiteContext),
 * o yüzden ayrı bir component.
 */
function DatabaseInitializer({ children }: { children: React.ReactNode }) {
  const db = useDb();
  const { success, error } = useMigrations(db, migrations);
  const [seedState, setSeedState] = useState<
    'idle' | 'seeding' | 'done' | 'error'
  >('idle');
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => {
    if (!success || seedState !== 'idle') return;

    setSeedState('seeding');
    seedIfEmpty(db)
      .then((result) => {
        if (result.seeded) {
          console.log(
            `[seed] ${result.exerciseCount} egzersiz yüklendi.`
          );
        }
        setSeedState('done');
      })
      .catch((err) => {
        console.error('[seed] Hata:', err);
        setSeedError(String(err));
        setSeedState('error');
      });
  }, [success, seedState, db]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-6">
        <Text className="text-danger text-center">
          Migration hatası: {error.message}
        </Text>
      </View>
    );
  }

  if (!success || seedState === 'seeding') {
    return (
      <View className="flex-1 items-center justify-center bg-bg gap-4">
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text className="text-muted text-sm tracking-wide">
          {!success
            ? 'Veritabanı hazırlanıyor...'
            : 'Egzersiz kütüphanesi yükleniyor...'}
        </Text>
      </View>
    );
  }

  if (seedState === 'error') {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-6">
        <Text className="text-danger text-center">
          Seed hatası: {seedError}
        </Text>
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SQLiteProvider
          databaseName={DATABASE_NAME}
          options={SQLITE_OPTIONS}
          onInit={initDatabase}
        >
          <DatabaseInitializer>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: COLORS.bg },
                headerShadowVisible: false,
                headerTintColor: COLORS.text,
                headerTitleStyle: { fontWeight: '600' },
                headerBackButtonDisplayMode: 'minimal',
                contentStyle: { backgroundColor: COLORS.bg },
              }}
            >
              <Stack.Screen
                name="(tabs)"
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="exercise/[id]"
                options={{ title: 'Egzersiz' }}
              />
              <Stack.Screen
                name="routine/[id]"
                options={{
                  title: 'Rutin',
                  presentation: 'modal',
                }}
              />
              <Stack.Screen
                name="templates/index"
                options={{ title: 'Hazır Programlar' }}
              />
              <Stack.Screen
                name="templates/[id]"
                options={{ title: 'Program' }}
              />
              <Stack.Screen
                name="metrics/[date]"
                options={{ title: 'Ölçüm', presentation: 'modal' }}
              />
              <Stack.Screen
                name="history"
                options={{ title: 'Antrenman Geçmişi' }}
              />
              <Stack.Screen
                name="session/[id]"
                options={{ title: 'Antrenman' }}
              />
              <Stack.Screen
                name="session/active"
                options={{
                  title: 'Antrenman',
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen
                name="onboarding"
                options={{ headerShown: false, gestureEnabled: false }}
              />
              <Stack.Screen
                name="legal/[doc]"
                options={{ title: 'Metin' }}
              />
              <Stack.Screen
                name="consent"
                options={{ headerShown: false, gestureEnabled: false }}
              />
            </Stack>
          </DatabaseInitializer>
        </SQLiteProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
