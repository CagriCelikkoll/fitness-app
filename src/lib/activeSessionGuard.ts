/**
 * Aktif antrenman ekranının "oturum yoksa Antrenman sekmesine dön" kapısı.
 *
 * Bitir akışı `endSession()` sonra `router.replace('/session/summary')`
 * yapıyor. Native stack, kapanan ekranı geçiş animasyonu bitene kadar
 * çizmeye devam ediyor; o sırada `activeSessionId` null olduğu için kapı
 * da `router.replace('/(tabs)/workout')` çağırıyordu ve bu, odaktaki yeni
 * ekranı (özeti) eziyordu: özet ve rekor sayfası hiç görünmüyordu.
 *
 * Kural: ekran antrenmanı kendisi bitirdiyse yönlendirmeyi bitirme akışı
 * yapar, kapı susar. Oturum başka yerden kapandıysa (ya da ekran oturumsuz
 * açıldıysa) eskisi gibi Antrenman sekmesine dönülür.
 */
export function shouldLeaveActiveScreen(activeSessionId: string | null, finishedHere: boolean): boolean {
  return activeSessionId == null && !finishedHere;
}
