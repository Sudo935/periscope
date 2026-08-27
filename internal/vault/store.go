package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/argon2"
)

type Connection struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	Bucket    string `json:"bucket"`
	Region    string `json:"region"`
	Endpoint  string `json:"endpoint"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
	Prefix    string `json:"prefix"`
}
type Data struct {
	Connections []Connection `json:"connections"`
	Settings Settings `json:"settings"`
}
type Settings struct { Theme string `json:"theme,omitempty"` }
type envelope struct{ Salt, Nonce, Ciphertext string }
type Store struct {
	db *sqlx.DB
	mu sync.Mutex
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	db, err := sqlx.Open("sqlite", filepath.Join(dir, "mariner.db"))
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS vaults (user_id TEXT PRIMARY KEY, salt TEXT NOT NULL, nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL)`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}
func (s *Store) Exists(userID string) (bool, error) {
	var count int
	err := s.db.Get(&count, "SELECT count(*) FROM vaults WHERE user_id = ?", userID)
	return count > 0, err
}
func (s *Store) Load(userID, password string) (Data, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var e envelope
	err := s.db.QueryRowx("SELECT salt, nonce, ciphertext FROM vaults WHERE user_id = ?", userID).Scan(&e.Salt, &e.Nonce, &e.Ciphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return Data{}, false, nil
	}
	if err != nil {
		return Data{}, false, err
	}
	data, err := decrypt(e, password)
	return data, true, err
}
func (s *Store) Save(userID, password string, data Data) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, err := encrypt(data, password)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO vaults(user_id,salt,nonce,ciphertext,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,nonce=excluded.nonce,ciphertext=excluded.ciphertext,updated_at=excluded.updated_at`, userID, e.Salt, e.Nonce, e.Ciphertext, time.Now().UTC().Format(time.RFC3339))
	return err
}
func (s *Store) Delete(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec("DELETE FROM vaults WHERE user_id = ?", userID)
	return err
}
func (s *Store) Close() error { return s.db.Close() }

func key(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
}
func encrypt(data Data, password string) (envelope, error) {
	salt, nonce := make([]byte, 16), make([]byte, 12)
	if _, err := rand.Read(salt); err != nil {
		return envelope{}, err
	}
	if _, err := rand.Read(nonce); err != nil {
		return envelope{}, err
	}
	block, err := aes.NewCipher(key(password, salt))
	if err != nil {
		return envelope{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return envelope{}, err
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return envelope{}, err
	}
	return envelope{base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(nonce), base64.RawStdEncoding.EncodeToString(gcm.Seal(nil, nonce, raw, nil))}, nil
}
func decrypt(e envelope, password string) (Data, error) {
	salt, err := base64.RawStdEncoding.DecodeString(e.Salt)
	if err != nil {
		return Data{}, err
	}
	nonce, err := base64.RawStdEncoding.DecodeString(e.Nonce)
	if err != nil {
		return Data{}, err
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(e.Ciphertext)
	if err != nil {
		return Data{}, err
	}
	block, err := aes.NewCipher(key(password, salt))
	if err != nil {
		return Data{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return Data{}, err
	}
	raw, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return Data{}, errors.New("incorrect master password")
	}
	var data Data
	return data, json.Unmarshal(raw, &data)
}
