package httpapi

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
	"mariner/internal/auth"
	"mariner/internal/config"
	s3client "mariner/internal/s3"
	"mariner/internal/vault"
)

type Server struct {
	Auth          *auth.Service
	Vault         *vault.Store
	Organizations map[string]config.Organization
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Get("/auth/login", s.login)
	r.Get("/auth/callback", s.callback)
	r.Get("/auth/logout", s.logout)
	r.Get("/api/me", s.me)
	r.Get("/api/vault/status", s.status)
	r.Post("/api/vault/unlock", s.unlock)
	r.Post("/api/vault/lock", s.lock)
	r.Delete("/api/vault", s.destroyVault)
	r.Get("/api/settings", s.settings)
	r.Put("/api/settings", s.updateSettings)
	r.Get("/api/connections", s.connections)
	r.Post("/api/connections", s.addConnection)
	r.Post("/api/connections/test", s.testConnection)
	r.Put("/api/connections", s.updateConnection)
	r.Delete("/api/connections", s.deleteConnection)
	r.Post("/api/folders", s.createFolder)
	r.Get("/api/browse", s.browse)
	r.Get("/api/file", s.file)
	r.Delete("/api/file", s.deleteFile)
	r.Post("/api/upload", s.upload)
	r.Get("/api/download", s.download)
	r.Handle("/*", http.FileServer(http.Dir("/web")))
	return r
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) { s.Auth.Login(w, r) }
func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	user, id, err := s.Auth.Callback(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	s.Auth.StartSession(w, id, user)
	http.Redirect(w, r, "/", http.StatusFound)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.Auth.Logout(w, r)
	http.Redirect(w, r, "/", http.StatusFound)
}
func (s *Server) session(r *http.Request) (auth.Session, string, error) {
	session, id, ok := s.Auth.Current(r)
	if !ok {
		return session, id, errors.New("sign in required")
	}
	return session, id, nil
}
func (s *Server) unlocked(r *http.Request) (auth.Session, string, vault.Data, error) {
	session, id, err := s.session(r)
	if err != nil {
		return session, id, vault.Data{}, err
	}
	if session.Password == "" {
		return session, id, vault.Data{}, errors.New("vault is locked")
	}
	data, _, err := s.Vault.Load(session.User.ID, session.Password)
	return session, id, data, err
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	session, _, ok := s.Auth.Current(r)
	if !ok {
		write(w, map[string]any{"authenticated": false})
		return
	}
	write(w, map[string]any{"authenticated": true, "name": session.User.Name})
}
func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	session, _, err := s.session(r)
	if err != nil {
		fail(w, 401, err)
		return
	}
	exists, err := s.Vault.Exists(session.User.ID)
	if err != nil {
		fail(w, 500, err)
		return
	}
	write(w, map[string]bool{"exists": exists})
}
func (s *Server) unlock(w http.ResponseWriter, r *http.Request) {
	session, id, err := s.session(r)
	if err != nil {
		fail(w, 401, err)
		return
	}
	var request struct {
		Password string `json:"password"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil || len(request.Password) < 10 {
		fail(w, 400, errors.New("master password must be at least 10 characters"))
		return
	}
	data, exists, err := s.Vault.Load(session.User.ID, request.Password)
	if err != nil {
		fail(w, 401, err)
		return
	}
	if !exists {
		data = vault.Data{}
		if err = s.Vault.Save(session.User.ID, request.Password, data); err != nil {
			fail(w, 500, err)
			return
		}
	}
	s.Auth.SetPassword(id, request.Password)
	write(w, publicConnections(s.withOrganizations(session.User, data)))
}
func (s *Server) lock(w http.ResponseWriter, r *http.Request) {
	_, id, err := s.session(r)
	if err != nil {
		fail(w, 401, err)
		return
	}
	s.Auth.Lock(id)
	write(w, map[string]bool{"ok": true})
}
func (s *Server) destroyVault(w http.ResponseWriter, r *http.Request) {
	session, id, err := s.session(r)
	if err != nil {
		fail(w, 401, err)
		return
	}
	if err := s.Vault.Delete(session.User.ID); err != nil {
		fail(w, 500, err)
		return
	}
	s.Auth.Lock(id)
	write(w, map[string]bool{"ok": true})
}
func (s *Server) connections(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	write(w, publicConnections(s.withOrganizations(session.User, data)))
}
func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	_, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	write(w, data.Settings)
}
func (s *Server) updateSettings(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	var settings vault.Settings
	if json.NewDecoder(r.Body).Decode(&settings) != nil || (settings.Theme != "light" && settings.Theme != "dark") {
		fail(w, 400, errors.New("theme must be light or dark"))
		return
	}
	data.Settings = settings
	if err = s.Vault.Save(session.User.ID, session.Password, data); err != nil {
		fail(w, 500, err)
		return
	}
	write(w, settings)
}
func (s *Server) addConnection(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	var c vault.Connection
	if json.NewDecoder(r.Body).Decode(&c) != nil || c.Name == "" || c.Bucket == "" {
		fail(w, 400, errors.New("name and bucket are required"))
		return
	}
	if err := validateS3Connection(r.Context(), c); err != nil {
		fail(w, http.StatusBadRequest, fmt.Errorf("connection test failed: %w", err))
		return
	}
	c.ID = randomID()
	data.Connections = append(data.Connections, c)
	if err = s.Vault.Save(session.User.ID, session.Password, data); err != nil {
		fail(w, 500, err)
		return
	}
	write(w, map[string]string{"id": c.ID})
}
func (s *Server) testConnection(w http.ResponseWriter, r *http.Request) {
	_, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	var c vault.Connection
	if json.NewDecoder(r.Body).Decode(&c) != nil || c.Bucket == "" {
		fail(w, http.StatusBadRequest, errors.New("bucket is required"))
		return
	}
	if c.ID != "" {
		for _, existing := range data.Connections {
			if existing.ID == c.ID {
				if c.AccessKey == "" {
					c.AccessKey = existing.AccessKey
				}
				if c.SecretKey == "" {
					c.SecretKey = existing.SecretKey
				}
				break
			}
		}
	}
	if err := validateS3Connection(r.Context(), c); err != nil {
		fail(w, http.StatusBadRequest, fmt.Errorf("connection test failed: %w", err))
		return
	}
	write(w, map[string]bool{"ok": true})
}

func validateS3Connection(ctx context.Context, c vault.Connection) error {
	client, err := s3client.New(ctx, c)
	if err != nil {
		return err
	}
	_, err = client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(c.Bucket)})
	return err
}
func (s *Server) updateConnection(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	var update vault.Connection
	if json.NewDecoder(r.Body).Decode(&update) != nil || update.ID == "" || update.Name == "" || update.Bucket == "" {
		fail(w, 400, errors.New("id, name, and bucket are required"))
		return
	}
	if s.isOrganizationConnection(update.ID) {
		fail(w, http.StatusForbidden, errors.New("organization connections cannot be edited"))
		return
	}
	for i := range data.Connections {
		if data.Connections[i].ID != update.ID {
			continue
		}
		if update.AccessKey == "" {
			update.AccessKey = data.Connections[i].AccessKey
		}
		if update.SecretKey == "" {
			update.SecretKey = data.Connections[i].SecretKey
		}
		if err := validateS3Connection(r.Context(), update); err != nil {
			fail(w, http.StatusBadRequest, fmt.Errorf("connection test failed: %w", err))
			return
		}
		data.Connections[i] = update
		if err = s.Vault.Save(session.User.ID, session.Password, data); err != nil {
			fail(w, 500, err)
			return
		}
		write(w, map[string]bool{"ok": true})
		return
	}
	fail(w, 404, errors.New("connection not found"))
}
func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	id := r.URL.Query().Get("id")
	if s.isOrganizationConnection(id) {
		fail(w, http.StatusForbidden, errors.New("organization connections cannot be deleted"))
		return
	}
	for i, c := range data.Connections {
		if c.ID == id {
			data.Connections = append(data.Connections[:i], data.Connections[i+1:]...)
			break
		}
	}
	if err = s.Vault.Save(session.User.ID, session.Password, data); err != nil {
		fail(w, 500, err)
		return
	}
	write(w, map[string]bool{"ok": true})
}
func (s *Server) isOrganizationConnection(id string) bool {
	for _, org := range s.Organizations {
		for _, connection := range org.Connections {
			if org.ID+":"+connection.ID == id {
				return true
			}
		}
	}
	return false
}
func (s *Server) createFolder(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	c, err := s.connection(r, data, session.User)
	if err != nil {
		fail(w, 404, err)
		return
	}
	var request struct{ Name, Prefix string }
	if json.NewDecoder(r.Body).Decode(&request) != nil || strings.TrimSpace(request.Name) == "" {
		fail(w, 400, errors.New("folder name is required"))
		return
	}
	name := strings.Trim(strings.TrimSpace(request.Name), "/")
	prefix := strings.Trim(request.Prefix, "/")
	key := name + "/"
	if prefix != "" {
		key = prefix + "/" + key
	}
	client, err := s3client.New(r.Context(), c)
	if err != nil {
		fail(w, 500, err)
		return
	}
	if _, err = client.PutObject(r.Context(), &s3.PutObjectInput{Bucket: aws.String(c.Bucket), Key: aws.String(key), Body: strings.NewReader("")}); err != nil {
		fail(w, 502, err)
		return
	}
	write(w, map[string]string{"key": key})
}
func (s *Server) connection(r *http.Request, data vault.Data, user auth.User) (vault.Connection, error) {
	connections := s.withOrganizations(user, data).Connections
	for _, c := range connections {
		if c.ID == r.URL.Query().Get("connection") {
			return c, nil
		}
	}
	return vault.Connection{}, errors.New("connection not found")
}
func (s *Server) withOrganizations(user auth.User, data vault.Data) vault.Data {
	result := vault.Data{Connections: append([]vault.Connection(nil), data.Connections...)}
	organizationNames := make([]string, 0, len(s.Organizations))
	for name := range s.Organizations {
		organizationNames = append(organizationNames, name)
	}
	sort.Strings(organizationNames)
	for _, organizationName := range organizationNames {
		org := s.Organizations[organizationName]
		if !hasGroup(user.Groups, org.Groups) {
			continue
		}
		connectionNames := make([]string, 0, len(org.Connections))
		for name := range org.Connections {
			connectionNames = append(connectionNames, name)
		}
		sort.Strings(connectionNames)
		for _, connectionName := range connectionNames {
			configured := org.Connections[connectionName]
			c := configured.Connection
			if c.ID == "" {
				c.ID = connectionName
			}
			if c.Name == "" {
				c.Name = connectionName
			}
			c.ID = org.ID + ":" + c.ID
			if org.Name != "" {
				c.Name = org.Name + " / " + c.Name
			}
			result.Connections = append(result.Connections, c)
		}
	}
	return result
}
func hasGroup(userGroups, required []string) bool {
	for _, userGroup := range userGroups {
		for _, group := range required {
			if userGroup == group {
				return true
			}
		}
	}
	return false
}

type item struct {
	Name     string     `json:"name"`
	Key      string     `json:"key"`
	Kind     string     `json:"kind"`
	Size     int64      `json:"size,omitempty"`
	Modified *time.Time `json:"modified,omitempty"`
}

func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	c, err := s.connection(r, data, session.User)
	if err != nil {
		fail(w, 404, err)
		return
	}
	client, err := s3client.New(r.Context(), c)
	if err != nil {
		fail(w, 500, err)
		return
	}
	prefix := r.URL.Query().Get("prefix")
	if prefix == "" {
		prefix = c.Prefix
	}
	result, err := client.ListObjectsV2(r.Context(), &s3.ListObjectsV2Input{Bucket: aws.String(c.Bucket), Prefix: aws.String(prefix), Delimiter: aws.String("/")})
	if err != nil {
		fail(w, 502, err)
		return
	}
	items := make([]item, 0)
	for _, p := range result.CommonPrefixes {
		key := aws.ToString(p.Prefix)
		items = append(items, item{Name: strings.TrimSuffix(strings.TrimPrefix(key, prefix), "/"), Key: key, Kind: "folder"})
	}
	for _, object := range result.Contents {
		key := aws.ToString(object.Key)
		if key != prefix {
			items = append(items, item{Name: path.Base(key), Key: key, Kind: "file", Size: aws.ToInt64(object.Size), Modified: object.LastModified})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Kind > items[j].Kind || items[i].Name < items[j].Name })
	write(w, map[string]any{"connection": c.Name, "prefix": prefix, "items": items})
}
func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	c, err := s.connection(r, data, session.User)
	if err != nil {
		fail(w, 404, err)
		return
	}
	client, err := s3client.New(r.Context(), c)
	if err != nil {
		fail(w, 500, err)
		return
	}
	object, err := client.GetObject(r.Context(), &s3.GetObjectInput{Bucket: aws.String(c.Bucket), Key: aws.String(r.URL.Query().Get("key"))})
	if err != nil {
		fail(w, 502, err)
		return
	}
	defer object.Body.Close()
	if object.ContentType != nil {
		w.Header().Set("Content-Type", aws.ToString(object.ContentType))
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", path.Base(r.URL.Query().Get("key"))))
	_, _ = io.Copy(w, object.Body)
}
func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	c, err := s.connection(r, data, session.User)
	if err != nil {
		fail(w, 404, err)
		return
	}
	client, err := s3client.New(r.Context(), c)
	if err != nil {
		fail(w, 500, err)
		return
	}
	_, err = client.DeleteObject(r.Context(), &s3.DeleteObjectInput{Bucket: aws.String(c.Bucket), Key: aws.String(r.URL.Query().Get("key"))})
	if err != nil {
		fail(w, 502, err)
		return
	}
	write(w, map[string]bool{"ok": true})
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	c, err := s.connection(r, data, session.User)
	if err != nil {
		fail(w, 404, err)
		return
	}
	if err = r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, 400, err)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, errors.New("file is required"))
		return
	}
	defer file.Close()
	client, err := s3client.New(r.Context(), c)
	if err != nil {
		fail(w, 500, err)
		return
	}
	_, err = client.PutObject(r.Context(), &s3.PutObjectInput{Bucket: aws.String(c.Bucket), Key: aws.String(r.URL.Query().Get("prefix") + header.Filename), Body: file, ContentType: aws.String(header.Header.Get("Content-Type"))})
	if err != nil {
		fail(w, 502, err)
		return
	}
	write(w, map[string]bool{"ok": true})
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	session, _, data, err := s.unlocked(r)
	if err != nil {
		fail(w, 423, err)
		return
	}
	c, err := s.connection(r, data, session.User)
	if err != nil {
		fail(w, 404, err)
		return
	}
	prefix, format := r.URL.Query().Get("prefix"), r.URL.Query().Get("format")
	if format != "zip" && format != "tgz" {
		fail(w, 400, errors.New("format must be zip or tgz"))
		return
	}
	client, err := s3client.New(r.Context(), c)
	if err != nil {
		fail(w, 500, err)
		return
	}
	name := strings.Trim(strings.TrimSuffix(prefix, "/"), "/")
	if name == "" {
		name = c.Bucket
	}
	ext := "." + format
	if format == "tgz" {
		ext = ".tar.gz"
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name+ext))
	var zw *zip.Writer
	var tw *tar.Writer
	var gz *gzip.Writer
	if format == "zip" {
		zw = zip.NewWriter(w)
		defer zw.Close()
	} else {
		gz = gzip.NewWriter(w)
		defer gz.Close()
		tw = tar.NewWriter(gz)
		defer tw.Close()
	}
	p := &s3.ListObjectsV2Input{Bucket: aws.String(c.Bucket), Prefix: aws.String(prefix)}
	for {
		out, e := client.ListObjectsV2(r.Context(), p)
		if e != nil {
			return
		}
		for _, obj := range out.Contents {
			key := aws.ToString(obj.Key)
			rel := strings.TrimPrefix(key, prefix)
			if rel == "" {
				continue
			}
			body, e := client.GetObject(r.Context(), &s3.GetObjectInput{Bucket: aws.String(c.Bucket), Key: aws.String(key)})
			if e != nil {
				return
			}
			if format == "zip" {
				entry, e := zw.Create(rel)
				if e == nil {
					_, e = io.Copy(entry, body.Body)
				}
				body.Body.Close()
				if e != nil {
					return
				}
			} else {
				header := &tar.Header{Name: rel, Mode: 0600, Size: aws.ToInt64(obj.Size), ModTime: aws.ToTime(obj.LastModified)}
				if e = tw.WriteHeader(header); e == nil {
					_, e = io.Copy(tw, body.Body)
				}
				body.Body.Close()
				if e != nil {
					return
				}
			}
		}
		if !aws.ToBool(out.IsTruncated) {
			break
		}
		p.ContinuationToken = out.NextContinuationToken
	}
}
func publicConnections(data vault.Data) []vault.Connection {
	result := make([]vault.Connection, 0, len(data.Connections))
	for _, c := range data.Connections {
		c.AccessKey, c.SecretKey = "", ""
		result = append(result, c)
	}
	return result
}
func randomID() string { return fmt.Sprintf("%d", time.Now().UnixNano()) }
func write(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, err error) { http.Error(w, err.Error(), status) }
