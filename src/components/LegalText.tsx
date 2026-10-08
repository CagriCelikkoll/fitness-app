import { Text, View } from 'react-native';

import { parseBold, type LegalBlock } from '@/content/legal';

/**
 * Yasal metin gösterimi: paragraf ve madde listesi, `**kalın**`.
 * 16 px gövde, rahat satır aralığı. Markdown paketi yok.
 */
export function LegalText({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <View className="gap-4">
      {blocks.map((block, i) =>
        block.kind === 'paragraph' ? (
          <RichLine key={i} text={block.text} />
        ) : (
          <View key={i} className="gap-2">
            {block.items.map((item, j) => (
              <View key={j} className="flex-row">
                <Text className="text-muted text-base leading-6 w-5">•</Text>
                <View className="flex-1">
                  <RichLine text={item} />
                </View>
              </View>
            ))}
          </View>
        )
      )}
    </View>
  );
}

export function RichLine({ text, className = '' }: { text: string; className?: string }) {
  return (
    <Text className={`text-white text-base leading-6 ${className}`}>
      {parseBold(text).map((span, i) =>
        span.bold ? (
          <Text key={i} className="font-semibold">
            {span.text}
          </Text>
        ) : (
          span.text
        )
      )}
    </Text>
  );
}
