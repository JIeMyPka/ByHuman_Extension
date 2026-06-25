import "./popup.css";
import { useCallback, useEffect, useState } from "react";
import { getMe } from "@shared/api";
import { API_BASE_URL, SIGN_IN_URL } from "@shared/config";
import type { AuthState } from "@shared/types";

const TWITTER_URL = "https://x.com/home";

export function Popup() {
    const [auth, setAuth] = useState<AuthState>({ status: "unknown" });
    const [resolvedUrl, setResolvedUrl] = useState<string>(API_BASE_URL); // ← добавь

    const refresh = useCallback(async () => {
        setAuth({ status: "checking" });
        try {
            const res = await getMe();
            setResolvedUrl(res.resolvedUrl); // ← добавь
            if (res.authenticated) {
                setAuth({ status: "authenticated", user: res.user });
            } else {
                setAuth({ status: "unauthenticated" });
            }
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Could not check login state. Backend returned non-JSON response.";
            setAuth({ status: "error", message });
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const openInNewTab = (url: string) => {
        window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
        <div className="bh-popup">
            <header className="bh-popup__header">
                <div className="bh-popup__wordmark" aria-label="by:human">
                    <span className="bh-popup__wm-bracket">[</span><span className="bh-popup__wm-by">by</span><span className="bh-popup__wm-colon">:</span><span className="bh-popup__wm-human">human</span><span className="bh-popup__wm-bracket">]</span>
                </div>
                <p className="bh-popup__subtitle">Writing receipts for the AI era.</p>
            </header>

            <main className="bh-popup__main">
                {auth.status === "unknown" || auth.status === "checking" ? (
                    <p className="bh-popup__status bh-popup__status--checking">
                        Checking login…
                    </p>
                ) : null}

                {auth.status === "authenticated" ? (
                    <>
                        <p className="bh-popup__status bh-popup__status--ok">
                            Signed in as
                            <br />
                            <strong>
                                {auth.user.displayName ?? auth.user.email ?? auth.user.id}
                            </strong>
                            {auth.user.email && auth.user.email !== auth.user.displayName ? (
                                <><br /><span className="bh-popup__email">{auth.user.email}</span></>
                            ) : null}
                        </p>
                        <p className="bh-popup__hint">Ready on X / Twitter and Gmail.</p>
                        <div className="bh-popup__actions">
                            <button type="button" className="bh-popup__btn bh-popup__btn--primary"
                                    onClick={() => openInNewTab(TWITTER_URL)}>
                                Open X / Twitter
                            </button>
                            <button type="button" className="bh-popup__btn" onClick={refresh}>
                                Refresh login state
                            </button>
                        </div>
                    </>
                ) : null}

                {auth.status === "unauthenticated" ? (
                    <>
                        <p className="bh-popup__status bh-popup__status--off">Not signed in</p>
                        <p className="bh-popup__hint">
                            Sign in on the ByHuman website, then refresh this popup.
                        </p>
                        <div className="bh-popup__actions">
                            <button type="button" className="bh-popup__btn bh-popup__btn--primary"
                                    onClick={() => openInNewTab(SIGN_IN_URL)}>
                                Sign in on ByHuman
                            </button>
                            <button type="button" className="bh-popup__btn" onClick={refresh}>
                                Refresh login state
                            </button>
                        </div>
                    </>
                ) : null}

                {auth.status === "error" ? (
                    <>
                        <p className="bh-popup__status bh-popup__status--err">
                            Could not reach backend
                        </p>
                        <p className="bh-popup__error">{auth.message}</p>
                        <p className="bh-popup__meta">
                            Backend URL: <code>{resolvedUrl}</code> {/* ← resolvedUrl */}
                        </p>
                        <div className="bh-popup__actions">
                            <button type="button" className="bh-popup__btn" onClick={refresh}>
                                Refresh login state
                            </button>
                        </div>
                    </>
                ) : null}
            </main>

            <footer className="bh-popup__footer">
                <span>{resolvedUrl.replace(/^https?:\/\//, "")}</span> {/* ← resolvedUrl */}
            </footer>
        </div>
    );
}