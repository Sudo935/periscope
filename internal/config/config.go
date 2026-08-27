package config

import (
	"encoding/json"
	"fmt"
	"os"

	"mariner/internal/vault"
)

type Organization struct {
	ID          string                            `json:"id"`
	Name        string                            `json:"name"`
	Groups      []string                          `json:"groups"`
	Connections map[string]OrganizationConnection `json:"connections"`
}
type OrganizationConnection struct {
	vault.Connection
	AccessKeyEnv string `json:"accessKeyEnv"`
	SecretKeyEnv string `json:"secretKeyEnv"`
}

type Config struct {
	Addr, DataDir, OIDCIssuer, OIDCClientID, OIDCClientSecret, OIDCRedirectURL, CookieSecret, OIDCGroupsClaim, OIDCAudienceClaim, OIDCAudience, OIDCNameClaim string
	OIDCDebugJWT                                                                                                                                              bool
	Organizations                                                                                                                                             map[string]Organization
}

func Load() Config {
	cfg := Config{Addr: value("ADDR", ":8080"), DataDir: value("DATA_DIR", "./data"), OIDCIssuer: os.Getenv("OIDC_ISSUER"), OIDCClientID: os.Getenv("OIDC_CLIENT_ID"), OIDCClientSecret: os.Getenv("OIDC_CLIENT_SECRET"), OIDCRedirectURL: os.Getenv("OIDC_REDIRECT_URL"), CookieSecret: value("COOKIE_SECRET", "change-me-in-production"), OIDCGroupsClaim: value("OIDC_GROUPS_CLAIM", "groups"), OIDCAudienceClaim: value("OIDC_AUDIENCE_CLAIM", "aud"), OIDCAudience: value("OIDC_AUDIENCE", os.Getenv("OIDC_CLIENT_ID")), OIDCNameClaim: value("OIDC_NAME_CLAIM", "name"), OIDCDebugJWT: os.Getenv("OIDC_DEBUG_JWT") == "true"}
	if raw := os.Getenv("MARINER_ORGANIZATIONS_JSON"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &cfg.Organizations); err != nil {
			panic(fmt.Sprintf("invalid MARINER_ORGANIZATIONS_JSON: %v", err))
		}
	}
	for orgName, organization := range cfg.Organizations {
		if organization.ID == "" {
			organization.ID = orgName
		}
		if organization.Name == "" {
			organization.Name = orgName
		}
		if len(organization.Groups) == 0 {
			organization.Groups = []string{orgName}
		}
		for name, configured := range organization.Connections {
			c := configured
			if c.ID == "" {
				c.ID = name
			}
			if c.Name == "" {
				c.Name = name
			}
			if c.AccessKeyEnv != "" {
				c.AccessKey = os.Getenv(c.AccessKeyEnv)
			}
			if c.SecretKeyEnv != "" {
				c.SecretKey = os.Getenv(c.SecretKeyEnv)
			}
			organization.Connections[name] = c
		}
		cfg.Organizations[orgName] = organization
	}
	return cfg
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
