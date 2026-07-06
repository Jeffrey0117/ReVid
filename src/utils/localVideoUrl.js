/**
 * Builds a local-video:// URL from an absolute file path.
 *
 * Each path segment is percent-encoded so filenames containing '#', '?' or
 * '%' survive URL parsing (encodeURI alone would leave '#' and '?' intact,
 * truncating the path as fragment/query). The protocol handler in
 * electron/main.cjs decodes with decodeURIComponent.
 *
 * Every construction site must use this helper — thumbnail/metadata caches
 * are keyed by the URL string, so mixed encodings would miss the cache.
 */
export const toLocalVideoUrl = (filePath) =>
  'local-video:///' + filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
