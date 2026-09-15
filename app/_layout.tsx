import '../global.css';

import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  SQLiteProvider,
  useSQLiteContext,
  type SQLiteDatabase,
} from 'expo-sqlite';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import migrations from '../drizzle/migrations';
import { DATABASE_NAME } from '@/db/client';
import * as schema from '@/db/schema';
import { seedIfEmpty } from '@/db/seed';

// React Query client — server/local DB state için
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 dakika
      retry: 1,
    },
  },
});

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
 * useSQLiteContext'in içinde olması gerekir, o yüzden ayrı bir component.
 */
function DatabaseInitializer({ children }: { children: React.ReactNode }) {
  const sqliteDb = useSQLiteContext();
  const db = drizzle(sqliteDb, { schema });
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
        <Text className="text-red-400 text-center">
          Migration hatası: {error.message}
        </Text>
      </View>
    );
  }

  if (!success || seedState === 'seeding') {
    return (
      <View className="flex-1 items-center justify-center bg-bg gap-4">
        <ActivityIndicator size="large" color="#22c55e" />
        <Text className="text-white">
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
        <Text className="text-red-400 text-center">
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
            <QueryClientProvider client={queryClient}>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: '#0f172a' },
                  headerTintColor: '#fff',
                  headerBackButtonDisplayMode: 'minimal',
                  contentStyle: { backgroundColor: '#0f172a' },
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
              </Stack>
            </QueryClientProvider>
          </DatabaseInitializer>
        </SQLiteProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
