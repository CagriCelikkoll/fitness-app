/**
 * Hareket listesi, yığın ekranı (v4.0a ek): salon üyesinde Hareketler sekmesi
 * yok; Rutinler ekranının üstünden buraya gelinir. İçerik sekmedekinin aynısı,
 * ek olarak geri düğmesi.
 */
import { ExercisesList } from '../(tabs)/exercises';

export default function ExerciseListRoute() {
  return <ExercisesList showBack />;
}
