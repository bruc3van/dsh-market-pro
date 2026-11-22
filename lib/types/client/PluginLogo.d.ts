/**
 * A plugin's own artwork (data URI or HTTPS URL, with two-edge fallback for
 * jsDelivr URLs), else its owner's GitHub avatar, else a built-in letter
 * placeholder. Each failed request (404, renamed repository, offline, blocked
 * by the host's CSP) moves one step down, so the layout never shows a broken image.
 */
export declare function PluginLogo({ src, name, fullName }: {
    src?: string;
    name: string;
    fullName?: string;
}): import("react").JSX.Element;
