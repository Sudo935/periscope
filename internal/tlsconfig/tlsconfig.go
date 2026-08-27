package tlsconfig

import (
	"crypto/x509"
	"os"
)

// RootCAs returns the platform trust pool with SSL_CERT_FILE appended.
func RootCAs() (*x509.CertPool, error) {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	file := os.Getenv("SSL_CERT_FILE")
	if file == "" {
		return pool, nil
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	if !pool.AppendCertsFromPEM(data) {
		return nil, os.ErrInvalid
	}
	return pool, nil
}
