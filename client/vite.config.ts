import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

/**
 * The service worker is a second entry, emitted flat at the site root.
 *
 * It has to live at /sw.js to control the root scope, and it must be its own
 * bundle — a worker that re-downloads the app and the ONNX runtime on every
 * update is a worker that never updates.
 */
function serviceWorker(): Plugin {
    return {
        name: "khoj-service-worker",
        apply: "build",
        config() {
            return {
                build: {
                    rollupOptions: {
                        // index.html must stay an input, or it is not built at all.
                        // The SW is a second entry emitted flat at the site root.
                        input: {
                            main: resolve(import.meta.dirname, "index.html"),
                            sw: resolve(import.meta.dirname, "src/sw.ts"),
                        },
                        output: {
                            entryFileNames: (chunk) =>
                                chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
                            chunkFileNames: "assets/[name]-[hash].js",
                        },
                    },
                },
            };
        },
    };
}

/**
 * Sentry DSNs are designed to be public, so this one is inlined at build time
 * from the client environment rather than imported from a module that would also
 * pull in server-only values.
 */
function sentryDsnPlugin(): Plugin {
    return {
        name: "sentry-dsn",
        config: () => ({
            define: {
                "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(
                    process.env.VITE_SENTRY_DSN ?? "",
                ),
            },
        }),
    };
}

const apiProxy = {
    "/api": {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
    },
};

export default defineConfig({
    plugins: [react(), tailwindcss(), sentryDsnPlugin(), serviceWorker()],
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "./src"),
        },
    },
    server: {
        // The API runs on :3000. Proxying keeps the browser same-origin in dev, so
        // CORS behaves the same locally as it does on the deployed Static Site.
        proxy: apiProxy,
    },
    preview: {
        // Same reason, and it matters for verification: `npm run preview` serves
        // the real build, so testing the built artefact locally is only possible
        // if /api resolves. Without this every request 404s and it looks like a
        // frontend bug rather than a missing proxy.
        proxy: apiProxy,
    },
    build: {
        target: "es2022",
        rollupOptions: {
            output: {
                // Transformers.js and its ONNX runtime are large and only needed
                // once retrieval runs. Keeping them out of the entry chunk is what
                // makes the shell paint instantly off the CDN.
                manualChunks(id: string) {
                    if (id.includes("@huggingface/transformers")) return "transformers";
                    if (id.includes("onnxruntime")) return "transformers";
                    return undefined;
                },
            },
        },
    },
    // The embedding model must never be bundled — it is fetched from the
    // Hugging Face CDN at runtime and cached by the browser.
    optimizeDeps: {
        exclude: ["@huggingface/transformers"],
    },
});