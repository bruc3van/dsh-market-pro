/**
 * Extract the highest-priority matching file from a gzipped tar response
 * stream. When the primary target (`targetPaths[0]`) finishes, the underlying
 * HTTP stream is cancelled immediately so the remaining archive is never
 * downloaded. If a lower-priority fallback path appears earlier in the tar
 * stream, it is retained while scanning continues for the primary target.
 * @param response - HTTP 200 response whose body is a `.tgz` stream.
 * @param targetPaths - Normalized paths in descending preference order.
 * @param maxBytes - Upper bound for both compressed download and decompressed output.
 * @returns The extracted file bytes.
 */
export declare function extractFileFromTgzResponse(response: Response, targetPaths: readonly string[], maxBytes: number): Promise<Buffer>;
