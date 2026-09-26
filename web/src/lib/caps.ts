let cached: string | null = null;

/** Codecs/containers this browser can play, sent to the server to choose direct play vs. transcoding. */
export function browserCaps(): string {
  if (cached !== null) return cached;
  const video = document.createElement('video');
  const can = (type: string): boolean => {
    try {
      if (video.canPlayType(type) === 'probably') return true;
      return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type) && video.canPlayType(type) !== '';
    } catch {
      return false;
    }
  };
  const caps: string[] = [];
  if (can('video/mp4; codecs="avc1.640028"')) caps.push('h264');
  if (can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"')) caps.push('hevc');
  if (can('video/webm; codecs="vp9"') || can('video/mp4; codecs="vp09.00.10.08"')) caps.push('vp9');
  if (can('video/webm; codecs="vp8"')) caps.push('vp8');
  if (can('video/mp4; codecs="av01.0.08M.08"')) caps.push('av1');
  if (can('audio/mp4; codecs="mp4a.40.2"')) caps.push('aac');
  if (can('audio/mpeg') || video.canPlayType('audio/mpeg') !== '') caps.push('mp3');
  if (can('audio/webm; codecs="opus"') || can('audio/mp4; codecs="opus"')) caps.push('opus');
  if (can('audio/webm; codecs="vorbis"') || can('audio/ogg; codecs="vorbis"')) caps.push('vorbis');
  if (can('audio/mp4; codecs="flac"') || can('audio/flac')) caps.push('flac');
  if (can('audio/mp4; codecs="ac-3"')) caps.push('ac3');
  if (can('audio/mp4; codecs="ec-3"')) caps.push('eac3');
  if (video.canPlayType('video/x-matroska; codecs="avc1.640028, mp4a.40.2"') === 'probably') caps.push('mkv');
  if (can('video/webm; codecs="vp9, opus"')) caps.push('webm');
  cached = caps.join(',');
  return cached;
}
