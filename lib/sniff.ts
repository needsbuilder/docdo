// 선언된 MIME 은 클라이언트가 아무렇게나 쓸 수 있다. 첫 바이트를 본다.
// HEIC 는 브라우저가 못 열면 원본(EXIF·GPS 포함)이 그대로 올라가므로 받지 않는다.
// 어르신 화면의 compress() 가 JPEG 로 바꿔 보내는 게 정상 경로다.

export type ImageKind = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

export function sniffImage(buf: Uint8Array): ImageKind | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}
