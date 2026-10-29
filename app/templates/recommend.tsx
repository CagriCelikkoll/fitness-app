/**
 * "Bana program öner" (v3.8): Hazır Programlar'ın en üstünden açılır;
 * karşılamanın program adımıyla aynı öneri (`ProgramRecommender`).
 * Mevcut kullanıcılar öneriye buradan ulaşıyor.
 */

import { ScrollView } from 'react-native';

import { ProgramRecommender, useProgramRecommender } from '@/components/ProgramRecommender';

export default function RecommendProgramScreen() {
  const recommender = useProgramRecommender();
  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-5 pt-4 gap-4 pb-12"
    >
      <ProgramRecommender {...recommender} />
    </ScrollView>
  );
}
