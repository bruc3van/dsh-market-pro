/**
 * Native-to-browse directory picker bridge for DSH Desktop and DSH-go/Web.
 *
 * Desktop profiles serve `directoryPicker.pick` ("native"); remote / mobile
 * profiles such as DSH-go serve `directoryPicker.list` + `createDirectory`
 * ("browse") and reject `pick` with `directory-picker/unavailable`.
 * This controller tries `pickDirectory` first, remembers when the connected
 * host serves `"browse"`, and drives an owner-scoped in-app folder browser
 * modal so every workspace-picking flow keeps working across both runtimes.
 */
import type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client';
export type DirectoryBrowserEntry = DirectoryEntry;
export type DirectoryBrowserListing = DirectoryListing;
export interface DirectoryPickerNavigation {
    pickDirectory(): Promise<string | null>;
    listDirectory?(path?: string, signal?: AbortSignal): Promise<DirectoryBrowserListing>;
    createDirectory?(path: string, name: string): Promise<string>;
}
export interface DirectoryBrowserState {
    readonly open: boolean;
    /** The mounted surface that opened this modal, so multi-surface mounts never stack duplicate dialogs. */
    readonly ownerId: string | null;
    readonly loading: boolean;
    readonly creating: boolean;
    readonly currentPath: string;
    readonly listing: DirectoryBrowserListing | null;
    readonly error: string;
    readonly createError: string;
    readonly canCreate: boolean;
}
export interface DirectoryBrowserController {
    getSnapshot(): DirectoryBrowserState;
    subscribe(listener: () => void): () => void;
    /** Pick one directory via the native dialog or the remote browse modal. */
    pick(ownerId?: string): Promise<string | null>;
    /** Navigate to another directory level inside the open browse modal. */
    browse(path?: string): Promise<void>;
    /** Create a child directory under the currently listed path and enter it. */
    createFolder(name: string): Promise<boolean>;
    /** Clear a transient create-folder error (e.g. when dismissing the form or editing the name). */
    clearCreateError(): void;
    /** Accept the currently listed directory and close the modal. */
    confirm(): void;
    /** Dismiss the modal without selecting a directory. When `ownerId` is given, only dismiss if owned by it. */
    cancel(ownerId?: string): void;
    /** Reset cached capability and dismiss any pending modal (e.g. on reconnect). */
    reset(): void;
}
/** Whether `pickDirectory()` failed specifically because the host serves `"browse"` instead of `"native"`. */
export declare function isBrowseDirectoryPickerError(error: unknown): boolean;
/** Create the shared directory-picker controller consumed by client flows and the browse modal. */
export declare function createDirectoryBrowser(navigation: DirectoryPickerNavigation): DirectoryBrowserController;
