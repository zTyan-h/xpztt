const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
export const PHOTO_SIZE = 320;

export function fitPhotoFrame(frame, width, height) {
  if (width < PHOTO_SIZE || height < PHOTO_SIZE) return null;
  return {
    x: clamp(frame?.x ?? (width - PHOTO_SIZE) / 2, 0, width - PHOTO_SIZE),
    y: clamp(frame?.y ?? (height - PHOTO_SIZE) / 2, 0, height - PHOTO_SIZE),
  };
}
