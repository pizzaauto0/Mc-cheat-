package net.pizzaauto.cheatbridge.net;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.pizzaauto.cheatbridge.CheatBridgeClient;
import net.pizzaauto.cheatbridge.CheatManager;
import net.pizzaauto.cheatbridge.ModConfig;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Lokaler WebSocket-Server (nur 127.0.0.1), ueber den die CheatHub-Electron-App mit
 * diesem Mod spricht. Protokoll: eine JSON-Nachricht pro Textframe.
 *
 * Eingehend (App -> Mod): {"type":"setCheat","id":..,"enabled":bool}
 *                         {"type":"setParam","id":..,"key":"value","value":number}
 *                         {"type":"action","id":..}
 *                         {"type":"ping"}
 * Ausgehend (Mod -> App): {"type":"hello", modVersion, minecraftVersion}
 *                         {"type":"state","cheats":{...},"player":..,"inWorld":bool}
 *                         {"type":"pong"}
 */
public class BridgeServer extends WebSocketServer {

    private static final Logger LOGGER = LoggerFactory.getLogger("CheatBridge");

    // Wird einmalig beim Klassenladen ausgewertet, damit der Port schon fuer den
    // super(...)-Aufruf im Konstruktor zur Verfuegung steht (config/cheatbridge.properties).
    private static final ModConfig CONFIG = ModConfig.load();

    private final CheatManager cheats;
    private final Gson gson = new Gson();
    private final Set<WebSocket> clients = ConcurrentHashMap.newKeySet();
    private Map<String, Object> lastBroadcastState = null;

    public BridgeServer(CheatManager cheats) {
        super(new InetSocketAddress("127.0.0.1", CONFIG.port));
        this.cheats = cheats;
        setReuseAddr(true);
    }

    @Override
    public void onStart() {
        LOGGER.info("CheatBridge WebSocket-Server laeuft auf 127.0.0.1:{}", CONFIG.port);
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        clients.add(conn);

        JsonObject hello = new JsonObject();
        hello.addProperty("type", "hello");
        hello.addProperty("modVersion", CheatBridgeClient.MOD_VERSION);
        hello.addProperty("minecraftVersion", "1.21.11");
        conn.send(gson.toJson(hello));

        sendStateTo(conn);
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        clients.remove(conn);
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            JsonObject obj = JsonParser.parseString(message).getAsJsonObject();
            String type = obj.has("type") ? obj.get("type").getAsString() : "";

            switch (type) {
                case "setCheat" -> cheats.setCheat(
                        obj.get("id").getAsString(),
                        obj.get("enabled").getAsBoolean());
                case "setParam" -> cheats.setParam(
                        obj.get("id").getAsString(),
                        obj.get("key").getAsString(),
                        obj.get("value").getAsDouble());
                case "action" -> cheats.triggerAction(obj.get("id").getAsString());
                case "ping" -> {
                    JsonObject pong = new JsonObject();
                    pong.addProperty("type", "pong");
                    conn.send(gson.toJson(pong));
                }
                default -> LOGGER.warn("Unbekannter Nachrichtentyp: {}", type);
            }

            broadcastState(true);
        } catch (Exception e) {
            LOGGER.warn("Konnte Nachricht nicht verarbeiten: {}", message, e);
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        LOGGER.warn("CheatBridge WebSocket-Fehler", ex);
    }

    public void stopBridge() {
        try {
            stop(500);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Wird jeden Client-Tick aufgerufen; sendet nur, wenn sich der Zustand geaendert hat. */
    public void broadcastStateIfChanged(CheatManager cheats) {
        Map<String, Object> snapshot = cheats.snapshot();
        if (snapshot.equals(lastBroadcastState)) return;
        lastBroadcastState = snapshot;
        broadcastState(false);
    }

    private void broadcastState(boolean force) {
        if (clients.isEmpty()) return;
        Map<String, Object> snapshot = cheats.snapshot();
        if (!force && snapshot.equals(lastBroadcastState)) return;
        lastBroadcastState = snapshot;

        JsonObject state = new JsonObject();
        state.addProperty("type", "state");
        state.add("cheats", gson.toJsonTree(snapshot));

        String json = gson.toJson(state);
        for (WebSocket conn : clients) {
            if (conn.isOpen()) conn.send(json);
        }
    }

    private void sendStateTo(WebSocket conn) {
        JsonObject state = new JsonObject();
        state.addProperty("type", "state");
        state.add("cheats", gson.toJsonTree(cheats.snapshot()));
        conn.send(gson.toJson(state));
    }
}
