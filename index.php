<?php
// CORS - Herkese açık
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Hata ayıklama
error_reporting(E_ALL);
ini_set('display_errors', 1);

// ============================================
// VERİTABANI AYARLARI (Railway'den gelecek)
// ============================================
$db_host = getenv('MYSQLHOST') ?: 'localhost';
$db_port = getenv('MYSQLPORT') ?: '3306';
$db_user = getenv('MYSQLUSER') ?: 'root';
$db_pass = getenv('MYSQLPASSWORD') ?: '';
$db_name = getenv('MYSQLDATABASE') ?: 'sohbet';

// ============================================
// VERİTABANI BAĞLANTISI
// ============================================
function baglan() {
    global $db_host, $db_port, $db_user, $db_pass, $db_name;
    try {
        $pdo = new PDO("mysql:host=$db_host;port=$db_port;dbname=$db_name", $db_user, $db_pass);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        
        // Tablo yoksa oluştur
        $pdo->exec("CREATE TABLE IF NOT EXISTS mesajlar (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kullanici VARCHAR(50) NOT NULL,
            mesaj TEXT NOT NULL,
            zaman DATETIME DEFAULT CURRENT_TIMESTAMP
        )");
        
        $pdo->exec("CREATE TABLE IF NOT EXISTS kullanicilar (
            id INT AUTO_INCREMENT PRIMARY KEY,
            kullanici VARCHAR(50) UNIQUE NOT NULL,
            son_aktif DATETIME DEFAULT CURRENT_TIMESTAMP
        )");
        
        return $pdo;
    } catch (PDOException $e) {
        die(json_encode(['hata' => 'Veritabanı bağlantı hatası: ' . $e->getMessage()]));
    }
}

$db = baglan();
$action = $_GET['action'] ?? '';

// ============================================
// 1. TEST
// ============================================
if ($action === 'test') {
    echo json_encode(['mesaj' => 'PHP ve MySQL çalışıyor!', 'db_host' => $db_host]);
    exit;
}

// ============================================
// 2. MESAJ GÖNDER (GET ile)
// ============================================
if ($action === 'mesaj_gonder') {
    $kullanici = $_GET['kullanici'] ?? 'Anonim';
    $mesaj = $_GET['mesaj'] ?? '';
    
    if (empty($mesaj)) {
        echo json_encode(['hata' => 'Mesaj boş olamaz!']);
        exit;
    }
    
    $stmt = $db->prepare("INSERT INTO mesajlar (kullanici, mesaj) VALUES (?, ?)");
    $stmt->execute([$kullanici, $mesaj]);
    
    echo json_encode(['basarili' => true, 'kullanici' => $kullanici, 'mesaj' => $mesaj]);
    exit;
}

// ============================================
// 3. MESAJLARI GETİR
// ============================================
if ($action === 'mesajlari_getir') {
    $stmt = $db->query("SELECT kullanici, mesaj, TIME_FORMAT(zaman, '%H:%i') AS zaman FROM mesajlar ORDER BY id DESC LIMIT 100");
    $mesajlar = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(array_reverse($mesajlar));
    exit;
}

// ============================================
// 4. KULLANICI EKLE
// ============================================
if ($action === 'kullanici_ekle') {
    $kullanici = $_GET['kullanici'] ?? '';
    
    if (empty($kullanici)) {
        echo json_encode(['hata' => 'Kullanıcı adı gerekli!']);
        exit;
    }
    
    // Eğer varsa güncelle, yoksa ekle
    $stmt = $db->prepare("INSERT INTO kullanicilar (kullanici) VALUES (?) ON DUPLICATE KEY UPDATE son_aktif = CURRENT_TIMESTAMP");
    $stmt->execute([$kullanici]);
    
    echo json_encode(['basarili' => true]);
    exit;
}

// ============================================
// 5. KULLANICI ÇIKAR
// ============================================
if ($action === 'kullanici_cikar') {
    $kullanici = $_GET['kullanici'] ?? '';
    
    if (!empty($kullanici)) {
        $stmt = $db->prepare("DELETE FROM kullanicilar WHERE kullanici = ?");
        $stmt->execute([$kullanici]);
    }
    
    echo json_encode(['basarili' => true]);
    exit;
}

// ============================================
// 6. KULLANICILARI GETİR (son 60 saniye aktif olanlar)
// ============================================
if ($action === 'kullanicilari_getir') {
    $stmt = $db->query("SELECT kullanici FROM kullanicilar WHERE son_aktif > DATE_SUB(NOW(), INTERVAL 60 SECOND)");
    $kullanicilar = $stmt->fetchAll(PDO::FETCH_COLUMN);
    echo json_encode($kullanicilar);
    exit;
}

// ============================================
// 7. CORS ve HATA
// ============================================
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

echo json_encode(['hata' => 'Geçersiz istek']);
?>