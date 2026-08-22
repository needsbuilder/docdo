// 촬영 사진을 업로드 크기로 줄인다. 긴 변 1600px, JPEG.
//
// ⚠ EXIF 회전을 반드시 살린다. createImageBitmap 의 기본값은 EXIF 를 무시해서,
//   세로로 찍은 고지서가 눕힌 채로 올라간다. 그러면 Parse·Extract 정확도가 떨어진다.

const MAX_DIM = 1600;
const QUALITY = 0.82;

export type CompressResult = { file: File; fellBack: boolean };

export async function compress(
  file: File,
  maxDim = MAX_DIM,
  quality = QUALITY,
): Promise<CompressResult> {
  try {
    // imageOrientation: "from-image" 가 EXIF 회전을 적용한다.
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d 컨텍스트 없음");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", quality),
    );
    if (!blob || blob.size === 0) throw new Error("toBlob 실패");

    return { file: new File([blob], "mail.jpg", { type: "image/jpeg" }), fellBack: false };
  } catch {
    // HEIC 처럼 브라우저가 못 여는 형식이면 원본을 그대로 보낸다.
    // 서버가 형식·크기를 다시 검사하므로 여기서 막지 않는다.
    return { file, fellBack: true };
  }
}
