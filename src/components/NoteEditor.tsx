/**
 * Çok satırlı not alanı — aktif antrenmandaki hareket notu ve seans
 * detayındaki antrenman notu.
 *
 * Kaydetme zamanlaması:
 * - Yazmayı bıraktıktan ~500 ms sonra (debounce)
 * - Odak kaybında hemen
 * - Uygulama arka plana atılınca hemen (AppState)
 * - Bileşen kaldırılırken (başka harekete geçiş, ekrandan çıkış) hemen
 *
 * `initialValue` yalnızca ilk render'da okunuyor: kendi yazdığımız
 * değer veritabanından geri dönünce imleci zıplatmasın. İçerik başka
 * bir kayda geçecekse çağıran taraf `key` ile bileşeni yeniden kurmalı.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { NotebookPen } from 'lucide-react-native';

import { COLORS } from '@/theme';

const SAVE_DEBOUNCE_MS = 500;

interface NoteEditorProps {
  initialValue: string | null;
  onSave: (text: string) => Promise<void>;
  /** Kapalıyken görünen bağlantı metni */
  addLabel: string;
  placeholder: string;
}

export function NoteEditor({
  initialValue,
  onSave,
  addLabel,
  placeholder,
}: NoteEditorProps) {
  const [text, setText] = useState(initialValue ?? '');
  // Not yoksa önce "Not ekle" bağlantısı; basınca alan açılıyor
  const [open, setOpen] = useState(!!initialValue);

  // Zamanlayıcı ve kaydedilmemiş değer ref'te: AppState ve unmount
  // temizliği en son değeri görsün
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const value = pendingRef.current;
    if (value == null) return;
    pendingRef.current = null;
    onSaveRef.current(value).catch((err) => {
      console.warn('[NOTE] Not kaydedilemedi:', err);
    });
  }, []);

  const handleChange = (value: string) => {
    setText(value);
    pendingRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        className="flex-row items-center self-start py-1 active:opacity-60"
      >
        <NotebookPen color={COLORS.muted} size={16} strokeWidth={1.75} />
        <Text className="text-muted text-sm ml-2">{addLabel}</Text>
      </Pressable>
    );
  }

  return (
    <View className="bg-bg-surface border border-border rounded-2xl px-4 py-3">
      <TextInput
        value={text}
        onChangeText={handleChange}
        onBlur={flush}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        multiline
        autoFocus={!initialValue}
        textAlignVertical="top"
        className="text-white text-base min-h-[64px]"
      />
    </View>
  );
}
