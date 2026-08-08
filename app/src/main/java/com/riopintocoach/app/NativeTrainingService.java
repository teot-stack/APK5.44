package com.riopintocoach.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Locale;

/**
 * Servicio nativo persistente de Río Pinto Coach.
 * Mantiene cronómetro, fases, GPS, TTS, música y notificación aunque la WebView
 * quede suspendida por bloqueo de pantalla.
 */
public class NativeTrainingService extends Service implements LocationListener, TextToSpeech.OnInitListener {
    public static final String ACTION_START = "com.riopintocoach.app.START_NATIVE_TRAINING";
    public static final String ACTION_RESTORE = "com.riopintocoach.app.RESTORE_NATIVE_TRAINING";
    public static final String ACTION_PAUSE = "com.riopintocoach.app.SET_NATIVE_PAUSE";
    public static final String ACTION_TOGGLE_PAUSE = "com.riopintocoach.app.TOGGLE_NATIVE_PAUSE";
    public static final String ACTION_CHANGE_PHASE = "com.riopintocoach.app.CHANGE_NATIVE_PHASE";
    public static final String ACTION_STOP = "com.riopintocoach.app.STOP_NATIVE_TRAINING";
    public static final String ACTION_SPEAK = "com.riopintocoach.app.SPEAK_NATIVE";
    public static final String ACTION_SETTINGS = "com.riopintocoach.app.UPDATE_NATIVE_SETTINGS";
    public static final String ACTION_SET_MUSIC_QUEUE = "com.riopintocoach.app.SET_MUSIC_QUEUE";
    public static final String ACTION_MUSIC_PAUSE = "com.riopintocoach.app.MUSIC_PAUSE";
    public static final String ACTION_MUSIC_RESUME = "com.riopintocoach.app.MUSIC_RESUME";
    public static final String ACTION_MUSIC_NEXT = "com.riopintocoach.app.MUSIC_NEXT";
    public static final String ACTION_MUSIC_STOP = "com.riopintocoach.app.MUSIC_STOP";
    public static final String ACTION_MUSIC_VOLUME = "com.riopintocoach.app.MUSIC_VOLUME";

    private static final String CHANNEL_ID = "rio_pinto_training";
    private static final int NOTIFICATION_ID = 2027;
    private static final String PREFS = "rio_pinto_native";
    private static final String PREF_SNAPSHOT = "trainingSnapshot";
    private static final String PREF_CONFIG = "trainingConfig";
    private static final double MAX_ACCEPTED_ACCURACY_M = 45.0;
    private static final double MIN_MOVING_SPEED_KMH = 1.2;
    private static final double MAX_PLAUSIBLE_SPEED_KMH = 120.0;
    private static final double MAX_VERTICAL_SPEED_MPS = 8.0;
    private static final long GAP_THRESHOLD_MS = 10_000L;
    private static final int ALTITUDE_WINDOW_SIZE = 5;

    public static volatile NativeTrainingService instance;

    private final IBinder binder = new LocalBinder();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<Phase> phases = new ArrayList<>();
    private final ArrayList<String> phaseStatuses = new ArrayList<>();
    private final ArrayList<Double> phaseResultElapsedMs = new ArrayList<>();
    private final ArrayList<MusicTrack> musicQueue = new ArrayList<>();
    private final ArrayDeque<Double> altitudeWindow = new ArrayDeque<>();

    private SharedPreferences prefs;
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingSpeech = null;
    private float pendingSpeechVolume = 1f;
    private float pendingSpeechRate = 1.08f;
    private MediaPlayer mediaPlayer;

    private boolean running = false;
    private boolean paused = false;
    private boolean finished = false;
    private boolean transition = true;
    private int phaseIndex = 0;
    private long transitionDurationMs = 10_000L;
    private double transitionRemainingMs = 10_000.0;
    private double phaseElapsedMs = 0.0;
    private double totalElapsedMs = 0.0;
    private long lastRealtimeMs = 0L;
    private long lastNotificationMs = 0L;
    private long lastSnapshotMs = 0L;
    private boolean voiceEnabled = true;
    private float voiceVolume = 0.9f;
    private boolean gpsEnabled = true;

    private Location lastValidLocation;
    private Location distanceAnchor;
    private boolean gpsSignalLost = false;
    private boolean hasGps = false;
    private double speedKmh = 0.0;
    private double distanceKm = 0.0;
    private double elevationM = 0.0;
    private Double elevationAnchor = null;

    private int musicIndex = 0;
    private boolean musicPausedByUser = false;
    private boolean musicLoopSingle = false;
    private float musicVolume = 0.35f;
    private String currentMusicName = "";

    public class LocalBinder extends Binder {
        NativeTrainingService getService() { return NativeTrainingService.this; }
    }

    private static class Phase {
        String name;
        long durationMs;
        String voiceText;
        final ArrayList<MusicTrack> musicQueue = new ArrayList<>();
        int musicStartIndex = 0;
        boolean musicOff = false;
        boolean musicLoopSingle = false;
    }

    private static class MusicTrack {
        String uri;
        String name;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        createNotificationChannel();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        tts = new TextToSpeech(this, this);
        acquireWakeLock();
        handler.post(tickRunnable);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            restoreSnapshotIfPossible();
            return START_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            startTraining(intent.getStringExtra("config"));
        } else if (ACTION_RESTORE.equals(action)) {
            if (!running) restoreSnapshotIfPossible();
        } else if (ACTION_PAUSE.equals(action)) {
            setPaused(intent.getBooleanExtra("paused", false));
        } else if (ACTION_TOGGLE_PAUSE.equals(action)) {
            setPaused(!paused);
        } else if (ACTION_CHANGE_PHASE.equals(action)) {
            changePhase(intent.getIntExtra("phaseIndex", phaseIndex));
        } else if (ACTION_STOP.equals(action)) {
            stopTrainingAndService();
        } else if (ACTION_SETTINGS.equals(action)) {
            updateSettings(intent.getStringExtra("settings"));
        } else if (ACTION_SPEAK.equals(action)) {
            speakText(
                intent.getStringExtra("text"),
                intent.getFloatExtra("volume", voiceVolume),
                intent.getFloatExtra("rate", 1.08f)
            );
        } else if (ACTION_SET_MUSIC_QUEUE.equals(action)) {
            setMusicQueue(
                intent.getStringExtra("queue"),
                intent.getIntExtra("startIndex", 0),
                intent.getFloatExtra("volume", musicVolume),
                intent.getBooleanExtra("paused", false),
                intent.getBooleanExtra("loopSingle", false)
            );
        } else if (ACTION_MUSIC_PAUSE.equals(action)) {
            pauseMusic();
        } else if (ACTION_MUSIC_RESUME.equals(action)) {
            resumeMusic();
        } else if (ACTION_MUSIC_NEXT.equals(action)) {
            nextMusic();
        } else if (ACTION_MUSIC_STOP.equals(action)) {
            stopMusicInternal(true);
        } else if (ACTION_MUSIC_VOLUME.equals(action)) {
            setMusicVolume(intent.getFloatExtra("volume", musicVolume));
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return binder; }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        stopLocationUpdates();
        stopMusicInternal(true);
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        instance = null;
        super.onDestroy();
    }

    private void parsePhaseMusic(JSONObject item, Phase phase) {
        phase.musicOff = item.optBoolean("musicOff", false);
        phase.musicLoopSingle = item.optBoolean("musicLoopSingle", false);
        phase.musicStartIndex = Math.max(0, item.optInt("musicStartIndex", 0));
        JSONArray queue = item.optJSONArray("musicQueue");
        if (queue == null) return;
        for (int i = 0; i < queue.length(); i++) {
            JSONObject entry = queue.optJSONObject(i);
            if (entry == null) continue;
            String uri = entry.optString("uri", "");
            if (uri.isEmpty()) continue;
            MusicTrack track = new MusicTrack();
            track.uri = uri;
            track.name = entry.optString("name", "Tema");
            phase.musicQueue.add(track);
        }
    }

    private void applyCurrentPhaseMusic() {
        if (phases.isEmpty() || phaseIndex < 0 || phaseIndex >= phases.size()) return;
        Phase phase = phases.get(phaseIndex);
        if (phase.musicOff || phase.musicQueue.isEmpty()) {
            stopMusicInternal(true);
            return;
        }
        musicQueue.clear();
        musicQueue.addAll(phase.musicQueue);
        musicLoopSingle = phase.musicLoopSingle;
        musicIndex = Math.min(Math.max(0, phase.musicStartIndex), musicQueue.size() - 1);
        playMusicIndex(musicIndex);
    }

    private void startTraining(String configJson) {
        if (configJson == null || configJson.isEmpty()) return;
        try {
            JSONObject config = new JSONObject(configJson);
            JSONArray phaseArray = config.optJSONArray("phases");
            phases.clear();
            if (phaseArray != null) {
                for (int i = 0; i < phaseArray.length(); i++) {
                    JSONObject item = phaseArray.getJSONObject(i);
                    Phase phase = new Phase();
                    phase.name = item.optString("name", "Etapa");
                    phase.durationMs = Math.max(1000L, Math.round(item.optDouble("durationSeconds", 1) * 1000.0));
                    phase.voiceText = item.optString("voiceText", phase.name);
                    parsePhaseMusic(item, phase);
                    phases.add(phase);
                }
            }
            if (phases.isEmpty()) return;
            phaseStatuses.clear();
            phaseResultElapsedMs.clear();
            for (int i = 0; i < phases.size(); i++) {
                phaseStatuses.add("pending");
                phaseResultElapsedMs.add(0.0);
            }

            transitionDurationMs = Math.max(0L, Math.round(config.optDouble("transitionSeconds", 10) * 1000.0));
            voiceEnabled = config.optBoolean("voiceEnabled", true);
            voiceVolume = (float) clamp(config.optDouble("voiceVolume", 0.9), 0, 1);
            gpsEnabled = config.optBoolean("gpsEnabled", true);
            musicVolume = (float) clamp(config.optDouble("musicVolume", 0.35), 0, 1);

            phaseIndex = 0;
            transition = true;
            transitionRemainingMs = transitionDurationMs;
            phaseElapsedMs = 0;
            totalElapsedMs = 0;
            paused = false;
            finished = false;
            running = true;
            distanceKm = 0;
            elevationM = 0;
            speedKmh = 0;
            hasGps = false;
            lastValidLocation = null;
            resetDistanceTracking();
            lastRealtimeMs = SystemClock.elapsedRealtime();
            prefs.edit().putString(PREF_CONFIG, configJson).apply();

            startForeground(NOTIFICATION_ID, buildNotification());
            if (gpsEnabled) startLocationUpdates(); else stopLocationUpdates();
            if (voiceEnabled) speakCurrentPhase();
            applyCurrentPhaseMusic();
            persistSnapshot(true);
        } catch (JSONException error) {
            error.printStackTrace();
        }
    }

    private void restoreSnapshotIfPossible() {
        String snapshot = prefs.getString(PREF_SNAPSHOT, "");
        String config = prefs.getString(PREF_CONFIG, "");
        if (snapshot.isEmpty() || config.isEmpty()) return;
        try {
            JSONObject snap = new JSONObject(snapshot);
            if (!snap.optBoolean("running", false) || snap.optBoolean("finished", false)) return;
            JSONObject cfg = new JSONObject(config);
            JSONArray phaseArray = cfg.optJSONArray("phases");
            phases.clear();
            if (phaseArray != null) {
                for (int i = 0; i < phaseArray.length(); i++) {
                    JSONObject item = phaseArray.getJSONObject(i);
                    Phase phase = new Phase();
                    phase.name = item.optString("name", "Etapa");
                    phase.durationMs = Math.max(1000L, Math.round(item.optDouble("durationSeconds", 1) * 1000.0));
                    phase.voiceText = item.optString("voiceText", phase.name);
                    parsePhaseMusic(item, phase);
                    phases.add(phase);
                }
            }
            if (phases.isEmpty()) return;
            phaseStatuses.clear();
            phaseResultElapsedMs.clear();
            JSONArray restoredResults = snap.optJSONArray("phaseResults");
            for (int i = 0; i < phases.size(); i++) {
                JSONObject result = restoredResults != null ? restoredResults.optJSONObject(i) : null;
                phaseStatuses.add(result != null ? result.optString("status", "pending") : "pending");
                phaseResultElapsedMs.add(result != null ? result.optDouble("elapsed", 0) * 1000.0 : 0.0);
            }
            transitionDurationMs = Math.max(0L, Math.round(cfg.optDouble("transitionSeconds", 10) * 1000.0));
            voiceEnabled = cfg.optBoolean("voiceEnabled", true);
            voiceVolume = (float) clamp(cfg.optDouble("voiceVolume", 0.9), 0, 1);
            gpsEnabled = cfg.optBoolean("gpsEnabled", true);
            phaseIndex = Math.min(phases.size() - 1, Math.max(0, snap.optInt("phaseIndex", 0)));
            transition = snap.optBoolean("transition", true);
            transitionRemainingMs = snap.optDouble("transitionRemaining", transitionDurationMs / 1000.0) * 1000.0;
            phaseElapsedMs = snap.optDouble("phaseElapsed", 0) * 1000.0;
            totalElapsedMs = snap.optDouble("totalElapsed", 0) * 1000.0;
            paused = snap.optBoolean("paused", false);
            finished = false;
            running = true;
            distanceKm = snap.optDouble("distance", 0);
            elevationM = snap.optDouble("elevation", 0);
            speedKmh = 0;
            lastRealtimeMs = SystemClock.elapsedRealtime();
            startForeground(NOTIFICATION_ID, buildNotification());
            if (gpsEnabled) startLocationUpdates();
            applyCurrentPhaseMusic();
        } catch (Exception ignored) {}
    }

    private final Runnable tickRunnable = new Runnable() {
        @Override public void run() {
            long now = SystemClock.elapsedRealtime();
            if (running && lastRealtimeMs == 0) lastRealtimeMs = now;
            double elapsedMs = running ? Math.max(0, now - lastRealtimeMs) : 0;
            lastRealtimeMs = now;
            if (running && !paused && !finished && elapsedMs > 0) consumeTime(elapsedMs);

            if (running && now - lastNotificationMs >= 1000) {
                updateNotification();
                lastNotificationMs = now;
            }
            if (running && now - lastSnapshotMs >= 1000) {
                persistSnapshot(false);
                lastSnapshotMs = now;
            }
            handler.postDelayed(this, 250);
        }
    };

    private void consumeTime(double elapsedMs) {
        double pending = elapsedMs;
        while (pending > 0.001 && running && !paused && !finished) {
            if (transition) {
                double step = Math.min(pending, Math.max(0, transitionRemainingMs));
                transitionRemainingMs -= step;
                totalElapsedMs += step;
                pending -= step;
                if (transitionRemainingMs <= 0.1) {
                    transition = false;
                    transitionRemainingMs = 0;
                    phaseElapsedMs = 0;
                }
                continue;
            }

            Phase phase = phases.get(phaseIndex);
            double remaining = Math.max(0, phase.durationMs - phaseElapsedMs);
            double step = Math.min(pending, remaining);
            phaseElapsedMs += step;
            totalElapsedMs += step;
            pending -= step;

            if (phaseElapsedMs >= phase.durationMs - 0.1) {
                phaseStatuses.set(phaseIndex, "completed");
                phaseResultElapsedMs.set(phaseIndex, (double) phase.durationMs);
                if (phaseIndex >= phases.size() - 1) {
                    finished = true;
                    paused = true;
                    stopLocationUpdates();
                    stopMusicInternal(true);
                    persistSnapshot(true);
                } else {
                    phaseIndex++;
                    transition = true;
                    transitionRemainingMs = transitionDurationMs;
                    phaseElapsedMs = 0;
                    resetDistanceTrackingAfterPhaseOnly();
                    if (voiceEnabled) speakCurrentPhase();
                    applyCurrentPhaseMusic();
                }
            }
        }
    }

    private void setPaused(boolean value) {
        if (!running || finished) return;
        paused = value;
        lastRealtimeMs = SystemClock.elapsedRealtime();
        resetDistanceTracking();
        persistSnapshot(true);
        updateNotification();
    }

    private void changePhase(int newIndex) {
        if (!running || finished || phases.isEmpty()) return;
        if (newIndex < 0 || newIndex >= phases.size()) return;
        if (!"completed".equals(phaseStatuses.get(phaseIndex))) {
            phaseStatuses.set(phaseIndex, "skipped");
            phaseResultElapsedMs.set(phaseIndex, Math.min(phaseElapsedMs, phases.get(phaseIndex).durationMs));
        }
        phaseIndex = newIndex;
        transition = true;
        transitionRemainingMs = transitionDurationMs;
        phaseElapsedMs = 0;
        lastRealtimeMs = SystemClock.elapsedRealtime();
        if (voiceEnabled) speakCurrentPhase();
        applyCurrentPhaseMusic();
        persistSnapshot(true);
        updateNotification();
    }

    private void stopTrainingAndService() {
        running = false;
        finished = true;
        paused = true;
        persistSnapshot(true);
        stopLocationUpdates();
        stopMusicInternal(true);
        prefs.edit().remove(PREF_CONFIG).apply();
        stopForeground(true);
        stopSelf();
    }

    private void updateSettings(String settingsJson) {
        if (settingsJson == null || settingsJson.isEmpty()) return;
        try {
            JSONObject settings = new JSONObject(settingsJson);
            boolean previousGps = gpsEnabled;
            gpsEnabled = settings.optBoolean("gpsEnabled", gpsEnabled);
            voiceEnabled = settings.optBoolean("voiceEnabled", voiceEnabled);
            voiceVolume = (float) clamp(settings.optDouble("voiceVolume", voiceVolume), 0, 1);
            setMusicVolume((float) clamp(settings.optDouble("musicVolume", musicVolume), 0, 1));
            if (gpsEnabled && !previousGps) startLocationUpdates();
            else if (!gpsEnabled && previousGps) {
                stopLocationUpdates();
                speedKmh = 0;
                hasGps = false;
                resetDistanceTracking();
            }
            updateNotification();
            persistSnapshot(true);
        } catch (JSONException ignored) {}
    }

    private void startLocationUpdates() {
        if (locationManager == null) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            locationManager.removeUpdates(this);
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2500L, 0f, this, Looper.getMainLooper());
            }
        } catch (Exception ignored) {}
    }

    private void stopLocationUpdates() {
        if (locationManager == null) return;
        try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
    }

    @Override
    public void onLocationChanged(Location location) {
        if (!running || location == null) return;
        long now = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        float accuracy = location.hasAccuracy() ? location.getAccuracy() : 999f;

        if (accuracy > MAX_ACCEPTED_ACCURACY_M) {
            gpsSignalLost = true;
            if (location.hasSpeed()) speedKmh = Math.max(0, location.getSpeed() * 3.6);
            return;
        }

        Location current = new Location(location);
        hasGps = true;
        if (location.hasSpeed()) {
            speedKmh = Math.max(0, location.getSpeed() * 3.6);
        } else if (lastValidLocation != null) {
            long dtMs = Math.max(1, now - lastValidLocation.getTime());
            speedKmh = lastValidLocation.distanceTo(current) / (dtMs / 1000.0) * 3.6;
        } else {
            speedKmh = 0;
        }
        if (!Double.isFinite(speedKmh) || speedKmh < 0) speedKmh = 0;
        lastValidLocation = current;

        if (paused || finished) {
            resetDistanceTracking();
            return;
        }

        if (distanceAnchor == null) {
            distanceAnchor = new Location(current);
            gpsSignalLost = false;
            updateElevation(current, 1.0);
            return;
        }

        long dtMs = now - distanceAnchor.getTime();
        if (dtMs <= 0) {
            distanceAnchor = new Location(current);
            gpsSignalLost = false;
            return;
        }

        double meters = distanceAnchor.distanceTo(current);
        double uncertainty = Math.max(4.0, (accuracy + distanceAnchor.getAccuracy()) * 0.35);
        double impliedKmh = meters / (dtMs / 1000.0) * 3.6;
        boolean recoveredGap = gpsSignalLost || dtMs > GAP_THRESHOLD_MS;

        if (impliedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
            distanceAnchor = new Location(current);
            gpsSignalLost = false;
            resetElevationAnchor();
            updateElevation(current, 1.0);
            return;
        }

        boolean movingNormally = impliedKmh >= MIN_MOVING_SPEED_KMH;
        boolean shouldAccumulate = meters > uncertainty && (recoveredGap || movingNormally);
        if (shouldAccumulate) {
            distanceKm += meters / 1000.0;
            updateElevation(current, dtMs / 1000.0);
            distanceAnchor = new Location(current);
        } else if (meters > uncertainty) {
            distanceAnchor = new Location(current);
            resetElevationAnchor();
            updateElevation(current, 1.0);
        }
        gpsSignalLost = false;
    }

    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) { gpsSignalLost = true; }
    @SuppressWarnings("deprecation")
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    private void resetDistanceTracking() {
        distanceAnchor = null;
        gpsSignalLost = false;
        resetElevationAnchor();
    }

    private void resetDistanceTrackingAfterPhaseOnly() {
        // No corta distancia al cambiar de etapa: preparación y etapas forman un continuo.
    }

    private void resetElevationAnchor() {
        elevationAnchor = null;
        altitudeWindow.clear();
    }

    private void updateElevation(Location location, double dtSeconds) {
        if (!location.hasAltitude()) return;
        altitudeWindow.addLast(location.getAltitude());
        while (altitudeWindow.size() > ALTITUDE_WINDOW_SIZE) altitudeWindow.removeFirst();
        ArrayList<Double> values = new ArrayList<>(altitudeWindow);
        Collections.sort(values);
        double altitude = values.get(values.size() / 2);
        if (elevationAnchor == null) {
            elevationAnchor = altitude;
            return;
        }
        double delta = altitude - elevationAnchor;
        double threshold = Math.min(6.0, Math.max(2.5, (location.hasAccuracy() ? location.getAccuracy() : 20) * 0.08));
        double verticalSpeed = dtSeconds > 0 ? Math.abs(delta) / dtSeconds : 0;
        if (verticalSpeed > MAX_VERTICAL_SPEED_MPS) {
            elevationAnchor = altitude;
            return;
        }
        if (delta >= threshold) {
            elevationM += delta;
            elevationAnchor = altitude;
        } else if (delta <= -threshold) {
            elevationAnchor = altitude;
        }
    }

    @Override
    public void onInit(int status) {
        ttsReady = status == TextToSpeech.SUCCESS;
        if (ttsReady) {
            tts.setLanguage(new Locale("es", "AR"));
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { duckMusic(true); }
                @Override public void onDone(String utteranceId) { handler.post(() -> duckMusic(false)); }
                @Override public void onError(String utteranceId) { handler.post(() -> duckMusic(false)); }
            });
            if (pendingSpeech != null) {
                String text = pendingSpeech;
                float volume = pendingSpeechVolume;
                float rate = pendingSpeechRate;
                pendingSpeech = null;
                speakText(text, volume, rate);
            }
        }
    }

    private void speakCurrentPhase() {
        if (!voiceEnabled || phases.isEmpty() || phaseIndex < 0 || phaseIndex >= phases.size()) return;
        speakText(phases.get(phaseIndex).voiceText, voiceVolume, 1.08f);
    }

    public void speakText(String text, float volume, float rate) {
        if (text == null || text.trim().isEmpty()) return;
        if (!ttsReady || tts == null) {
            pendingSpeech = text;
            pendingSpeechVolume = volume;
            pendingSpeechRate = rate;
            return;
        }
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, (float) clamp(volume, 0, 1));
        tts.setSpeechRate((float) clamp(rate, 0.6, 1.5));
        tts.stop();
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "rpc-phase-" + System.nanoTime());
    }

    private void setMusicQueue(String queueJson, int startIndex, float volume, boolean userPaused, boolean loopSingle) {
        musicQueue.clear();
        try {
            JSONArray array = new JSONArray(queueJson == null ? "[]" : queueJson);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                String uri = item.optString("uri", "");
                if (uri.isEmpty()) continue;
                MusicTrack track = new MusicTrack();
                track.uri = uri;
                track.name = item.optString("name", "Tema");
                musicQueue.add(track);
            }
        } catch (JSONException ignored) {}
        if (musicQueue.isEmpty()) {
            stopMusicInternal(true);
            return;
        }
        musicVolume = (float) clamp(volume, 0, 1);
        musicPausedByUser = userPaused;
        musicLoopSingle = loopSingle;
        musicIndex = Math.max(0, Math.min(startIndex, musicQueue.size() - 1));
        playMusicIndex(musicIndex);
    }

    private void playMusicIndex(int index) {
        if (musicQueue.isEmpty()) return;
        musicIndex = ((index % musicQueue.size()) + musicQueue.size()) % musicQueue.size();
        MusicTrack track = musicQueue.get(musicIndex);
        stopMusicInternal(false);
        try {
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build());
            player.setDataSource(this, Uri.parse(track.uri));
            player.setVolume(musicVolume, musicVolume);
            player.setOnPreparedListener(mp -> {
                currentMusicName = track.name;
                if (!musicPausedByUser && running && !finished) mp.start();
            });
            player.setOnCompletionListener(mp -> {
                if (musicLoopSingle) {
                    mp.seekTo(0);
                    if (!musicPausedByUser) mp.start();
                } else {
                    nextMusic();
                }
            });
            player.setOnErrorListener((mp, what, extra) -> {
                handler.postDelayed(this::nextMusic, 250);
                return true;
            });
            mediaPlayer = player;
            player.prepareAsync();
        } catch (Exception error) {
            handler.postDelayed(this::nextMusic, 250);
        }
    }

    public void pauseMusic() {
        musicPausedByUser = true;
        try { if (mediaPlayer != null && mediaPlayer.isPlaying()) mediaPlayer.pause(); } catch (Exception ignored) {}
    }

    public void resumeMusic() {
        musicPausedByUser = false;
        try {
            if (mediaPlayer != null) mediaPlayer.start();
            else if (!musicQueue.isEmpty()) playMusicIndex(musicIndex);
        } catch (Exception ignored) {}
    }

    public void nextMusic() {
        if (musicQueue.isEmpty()) return;
        playMusicIndex(musicIndex + 1);
    }

    public void setMusicVolume(float volume) {
        musicVolume = (float) clamp(volume, 0, 1);
        try { if (mediaPlayer != null) mediaPlayer.setVolume(musicVolume, musicVolume); } catch (Exception ignored) {}
    }

    private void stopMusicInternal(boolean clearQueue) {
        if (mediaPlayer != null) {
            try { mediaPlayer.setOnCompletionListener(null); } catch (Exception ignored) {}
            try { mediaPlayer.stop(); } catch (Exception ignored) {}
            try { mediaPlayer.release(); } catch (Exception ignored) {}
            mediaPlayer = null;
        }
        currentMusicName = "";
        if (clearQueue) musicQueue.clear();
    }

    private void duckMusic(boolean duck) {
        try {
            if (mediaPlayer != null) {
                float v = duck ? Math.max(0.02f, musicVolume * 0.08f) : musicVolume;
                mediaPlayer.setVolume(v, v);
            }
        } catch (Exception ignored) {}
    }

    public boolean isMusicPlaying() {
        try { return mediaPlayer != null && mediaPlayer.isPlaying() && !musicPausedByUser; }
        catch (Exception ignored) { return false; }
    }

    public int getMusicPositionMs() {
        try { return mediaPlayer != null ? mediaPlayer.getCurrentPosition() : 0; }
        catch (Exception ignored) { return 0; }
    }

    public String getCurrentMusicName() { return currentMusicName == null ? "" : currentMusicName; }

    public String getSnapshotJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("running", running);
            json.put("phaseIndex", phaseIndex);
            json.put("phaseElapsed", phaseElapsedMs / 1000.0);
            json.put("totalElapsed", totalElapsedMs / 1000.0);
            json.put("transition", transition);
            json.put("transitionRemaining", transitionRemainingMs / 1000.0);
            json.put("paused", paused);
            json.put("finished", finished);
            json.put("distance", distanceKm);
            json.put("elevation", elevationM);
            json.put("speed", speedKmh);
            json.put("hasGps", hasGps);
            json.put("musicPlaying", isMusicPlaying());
            json.put("musicTrack", getCurrentMusicName());
            JSONArray results = new JSONArray();
            for (int i = 0; i < phaseStatuses.size(); i++) {
                JSONObject result = new JSONObject();
                result.put("status", phaseStatuses.get(i));
                result.put("elapsed", phaseResultElapsedMs.get(i) / 1000.0);
                results.put(result);
            }
            json.put("phaseResults", results);
        } catch (JSONException ignored) {}
        return json.toString();
    }

    private void persistSnapshot(boolean force) {
        if (!running && !force) return;
        prefs.edit().putString(PREF_SNAPSHOT, getSnapshotJson()).apply();
    }

    public static String storedSnapshot(Context context) {
        return context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_SNAPSHOT, "{}");
    }

    public static String storedConfig(Context context) {
        return context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_CONFIG, "");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Entrenamiento en curso",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Mantiene activo GPS, cronómetro, música y voz durante el entrenamiento.");
            channel.setSound(null, null);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
            this, 10, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent pauseIntent = new Intent(this, NativeTrainingService.class).setAction(ACTION_TOGGLE_PAUSE);
        PendingIntent pausePending = PendingIntent.getService(
            this, 11, pauseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String phaseName = phases.isEmpty() ? "Preparando entrenamiento" : phases.get(Math.min(phaseIndex, phases.size() - 1)).name;
        String stateText = finished
            ? "Entrenamiento completado"
            : paused
                ? "Pausado · " + formatDuration(totalElapsedMs)
                : (transition ? "Preparación · " : "Etapa · ") + formatDuration(totalElapsedMs);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Río Pinto Coach")
            .setContentText(phaseName + " · " + stateText)
            .setSubText(String.format(Locale.US, "%.2f km · %.1f km/h prom.", distanceKm, totalElapsedMs > 0 ? distanceKm * 3_600_000.0 / totalElapsedMs : 0))
            .setOngoing(!finished)
            .setOnlyAlertOnce(true)
            .setContentIntent(openPending)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (!finished) {
            builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_pause,
                paused ? "Continuar" : "Pausa",
                pausePending
            ).build());
        }
        return builder.build();
    }

    private void updateNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
    }

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager == null) return;
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RioPintoCoach::TrainingWakeLock");
        wakeLock.setReferenceCounted(false);
        try { wakeLock.acquire(); } catch (Exception ignored) {}
    }

    private static String formatDuration(double milliseconds) {
        long seconds = Math.max(0, (long) Math.floor(milliseconds / 1000.0));
        long hours = seconds / 3600;
        long minutes = (seconds % 3600) / 60;
        long secs = seconds % 60;
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, secs);
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }
}
