export function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl: string) {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`
}

export function buildCdnUploadUrl(cdnBaseUrl: string, uploadParam: string, filekey: string) {
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`
}
