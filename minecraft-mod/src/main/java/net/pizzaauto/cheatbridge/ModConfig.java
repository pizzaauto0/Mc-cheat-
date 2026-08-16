package net.pizzaauto.cheatbridge;

import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * Liest den WebSocket-Port aus {@code config/cheatbridge.properties} im Minecraft-
 * Ordner. Existiert die Datei nicht, wird sie mit dem Standardport angelegt. Der Port
 * muss mit dem "Minecraft-Bridge-Port" in den CheatHub-Einstellungen uebereinstimmen.
 */
public final class ModConfig {

    private static final Logger LOGGER = LoggerFactory.getLogger("CheatBridge");
    private static final int DEFAULT_PORT = 34551;

    public final int port;

    private ModConfig(int port) {
        this.port = port;
    }

    public static ModConfig load() {
        Path path = FabricLoader.getInstance().getConfigDir().resolve("cheatbridge.properties");
        Properties props = new Properties();

        if (Files.exists(path)) {
            try (InputStream in = Files.newInputStream(path)) {
                props.load(in);
            } catch (IOException e) {
                LOGGER.warn("Konnte cheatbridge.properties nicht lesen, nutze Standardwerte", e);
            }
        }

        int port;
        try {
            port = Integer.parseInt(props.getProperty("port", String.valueOf(DEFAULT_PORT)).trim());
        } catch (NumberFormatException e) {
            LOGGER.warn("Ungueltiger Port in cheatbridge.properties, nutze Standard {}", DEFAULT_PORT);
            port = DEFAULT_PORT;
        }

        if (!Files.exists(path)) {
            props.setProperty("port", String.valueOf(port));
            try {
                Files.createDirectories(path.getParent());
                try (OutputStream out = Files.newOutputStream(path)) {
                    props.store(out, "CheatBridge-Konfiguration -- der Port muss mit der CheatHub-App uebereinstimmen");
                }
            } catch (IOException e) {
                LOGGER.warn("Konnte cheatbridge.properties nicht anlegen", e);
            }
        }

        return new ModConfig(port);
    }
}
