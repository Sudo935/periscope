package main

import (
	"log"
	"net/http"

	"mariner/internal/auth"
	"mariner/internal/config"
	"mariner/internal/httpapi"
	"mariner/internal/vault"
	_ "modernc.org/sqlite"
)

func main() {
	cfg := config.Load()
	store, err := vault.Open(cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	if cfg.OIDCIssuer == "" {
		log.Fatal("OIDC_ISSUER is required")
	}
	authService, err := auth.New(cfg.OIDCIssuer, cfg.OIDCClientID, cfg.OIDCClientSecret, cfg.OIDCRedirectURL, cfg.CookieSecret, cfg.OIDCGroupsClaim, cfg.OIDCAudienceClaim, cfg.OIDCAudience, cfg.OIDCNameClaim, cfg.OIDCDebugJWT)
	if err != nil {
		log.Fatal(err)
	}
	server := &httpapi.Server{Auth: authService, Vault: store, Organizations: cfg.Organizations}
	log.Printf("mariner listening on %s", cfg.Addr)
	log.Fatal(http.ListenAndServe(cfg.Addr, server.Router()))
}
