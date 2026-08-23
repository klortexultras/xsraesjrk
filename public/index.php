<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$action = $_GET['action'] ?? '';

if ($action === 'test') {
    die(json_encode(['mesaj' => 'PHP ve Docker çalışıyor!']));
}

if ($action === 'mesaj_gonder') {
    $kullanici = $_GET['kullanici'] ?? 'Anonim';
    $mesaj = $_GET['mesaj'] ?? '';
    
    if (empty($mesaj)) {
        die(json_encode(['hata' => 'Mesaj boş']));
    }
    
    $dosya = 'mesajlar.json';
    $liste = file_exists($dosya) ? json_decode(file_get_contents($dosya), true) : [];
    if (!is_array($liste)) $liste = [];
    
    $liste[] = [
        'kullanici' => $kullanici,
        'mesaj' => $mesaj,
        'zaman' => date('H:i:s')
    ];
    
    if (count($liste) > 100) $liste = array_slice($liste, -100);
    file_put_contents($dosya, json_encode($liste));
    
    die(json_encode(['basarili' => true]));
}

if ($action === 'mesajlari_getir') {
    $dosya = 'mesajlar.json';
    if (file_exists($dosya)) {
        echo file_get_contents($dosya);
    } else {
        echo '[]';
    }
    exit;
}

if ($action === 'kullanici_ekle') {
    $kullanici = $_GET['kullanici'] ?? '';
    
    $dosya = 'kullanicilar.json';
    $liste = file_exists($dosya) ? json_decode(file_get_contents($dosya), true) : [];
    if (!is_array($liste)) $liste = [];
    
    if (!empty($kullanici) && !in_array($kullanici, $liste)) {
        $liste[] = $kullanici;
    }
    
    file_put_contents($dosya, json_encode($liste));
    echo json_encode(['basarili' => true]);
    exit;
}

if ($action === 'kullanicilari_getir') {
    $dosya = 'kullanicilar.json';
    if (file_exists($dosya)) {
        echo file_get_contents($dosya);
    } else {
        echo '[]';
    }
    exit;
}

if ($action === 'kullanici_cikar') {
    $kullanici = $_GET['kullanici'] ?? '';
    
    $dosya = 'kullanicilar.json';
    if (file_exists($dosya)) {
        $liste = json_decode(file_get_contents($dosya), true);
        if (!is_array($liste)) $liste = [];
        $liste = array_values(array_diff($liste, [$kullanici]));
        file_put_contents($dosya, json_encode($liste));
    }
    
    echo json_encode(['basarili' => true]);
    exit;
}

echo json_encode(['hata' => 'Geçersiz istek']);
?>