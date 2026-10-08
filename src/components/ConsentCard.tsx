import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';

import { HEALTH_CONSENT_TEXT } from '@/content/legal';
import { COLORS } from '@/theme';
import { Card, PrimaryButton } from '@/components/ui';

/**
 * Açık rıza kartı (METİN 3): başlık, metin, "Onaylıyorum" kutusu.
 * Kutu hiçbir yerde önceden işaretli gelmez.
 *
 * - `action` verilirse kartın altında düğme var; yalnızca kutu
 *   işaretliyken basılabiliyor (ör. "Onayla ve devam et").
 * - Verilmezse kutu dışarıdan yönetiliyor (`checked` / `onCheckedChange`);
 *   karşılamadaki adım kendi "Devam" düğmesini kullanıyor.
 *
 * "Aydınlatma Metni" bağlantısı yasal metin ekranını açar (Modal değil,
 * yığına push).
 */
export function ConsentCard({
  checked: checkedProp,
  onCheckedChange,
  action,
  showNoticeLink = true,
}: {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  action?: { label: string; onConfirm: () => Promise<unknown> | void };
  /** Kartın içindeki "Aydınlatma Metni" bağlantısı (bağlantılar zaten üstteyse kapat) */
  showNoticeLink?: boolean;
}) {
  const router = useRouter();
  const [checkedState, setCheckedState] = useState(false);
  const [busy, setBusy] = useState(false);
  const checked = checkedProp ?? checkedState;

  const toggle = () => {
    const next = !checked;
    if (checkedProp == null) setCheckedState(next);
    onCheckedChange?.(next);
  };

  const confirm = async () => {
    if (!action || !checked) return;
    setBusy(true);
    try {
      await action.onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-4">
      <Text className="text-white text-lg font-semibold tracking-tight">
        {HEALTH_CONSENT_TEXT.title}
      </Text>
      <Text className="text-white text-base leading-6">{HEALTH_CONSENT_TEXT.body}</Text>
      {showNoticeLink && (
        <Pressable
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'kvkk' } })}
          hitSlop={6}
          accessibilityRole="link"
          className="self-start active:opacity-60"
        >
          <Text className="text-accent text-sm font-semibold">Aydınlatma Metni'ni oku →</Text>
        </Pressable>
      )}
      <ConsentCheckbox
        checked={checked}
        label={HEALTH_CONSENT_TEXT.checkboxLabel}
        onToggle={toggle}
      />
      {action && (
        <PrimaryButton
          label={action.label}
          disabled={!checked || busy}
          loading={busy}
          onPress={() => void confirm()}
        />
      )}
    </Card>
  );
}

export function ConsentCheckbox({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      hitSlop={6}
      className="flex-row items-center self-start active:opacity-70"
    >
      <View
        className={`w-7 h-7 rounded-lg items-center justify-center border-2 ${
          checked ? 'bg-accent border-accent' : 'border-border'
        }`}
      >
        {checked && <Check color={COLORS.accentFg} size={18} strokeWidth={3} />}
      </View>
      <Text className="text-white text-base font-semibold ml-3">{label}</Text>
    </Pressable>
  );
}
