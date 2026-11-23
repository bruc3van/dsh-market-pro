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
export interface SubdirExtractLimits {
    readonly maxCompressedBytes: number;
    readonly maxDecompressedBytes: number;
    readonly maxExtractedBytes: number;
    readonly maxFileBytes: number;
    readonly maxFiles: number;
}
export interface ExtractedSubdir {
    readonly files: ReadonlyMap<string, Buffer>;
    readonly totalBytes: number;
}
/**
 * Stream a GitHub repository `.tar.gz` archive (which always nests repository
 * files under a single `<repo>-<ref>/` root prefix) and extract only regular
 * files under `subdir` (or the repository root when `subdir === ''`).
 *
 * Symlinks, hardlinks, special files, and path-traversal entries are ignored
 * or rejected, and memory is bounded strictly to the extracted skill files.
 */
export declare function extractSubdirFromTgzResponse(response: Response, subdir: string, limits: SubdirExtractLimits): Promise<ExtractedSubdir>;
