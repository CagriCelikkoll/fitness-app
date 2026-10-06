import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { COLORS } from '@/theme';

const STROKE = 9;

/**
 * Haftalık hedef halkası: ortada "2 / 3", altında "Bu hafta". Hedefe
 * doğru beyaz dolar; tutturulunca halka ve sayı vurgu renginde.
 */
export function GoalRing({
  done,
  goal,
  size = 112,
}: {
  done: number;
  goal: number;
  size?: number;
}) {
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = goal > 0 ? Math.min(done / goal, 1) : 0;
  const complete = done >= goal;
  const color = complete ? COLORS.accent : COLORS.text;

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityLabel={`Bu hafta ${done} / ${goal} gün`}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLORS.border}
          strokeWidth={STROKE}
          fill="none"
        />
        {progress > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - progress)}
            // 12 yönünden saat yönünde başlasın
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <View className="absolute inset-0 items-center justify-center">
        <Text
          className={`text-2xl font-bold tabular-nums ${
            complete ? 'text-accent' : 'text-white'
          }`}
        >
          {done} / {goal}
        </Text>
        <Text className="text-muted text-xs mt-0.5">Bu hafta</Text>
      </View>
    </View>
  );
}
