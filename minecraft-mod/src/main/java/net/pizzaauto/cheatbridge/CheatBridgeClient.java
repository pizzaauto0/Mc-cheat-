package net.pizzaauto.cheatbridge;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ClientLifecycleEvents;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.pizzaauto.cheatbridge.net.BridgeServer;
import net.pizzaauto.cheatbridge.render.EspRenderer;
import net.pizzaauto.cheatbridge.render.TracerRenderer;
import net.pizzaauto.cheatbridge.render.WaypointRenderer;
import org.lwjgl.glfw.GLFW;

/**
 * Einstiegspunkt des CheatBridge-Mods. Startet den lokalen WebSocket-Server fuer die
 * CheatHub-App und haengt sich in Tick-/Render-Events ein, um die aktiven Cheats
 * jeden Frame anzuwenden.
 */
public class CheatBridgeClient implements ClientModInitializer {

    public static final String MOD_ID = "cheatbridge";
    public static final String MOD_VERSION = "0.1.0";

    public static CheatManager CHEATS;
    private static BridgeServer server;
    private static KeyBinding addWaypointKey;

    @Override
    public void onInitializeClient() {
        CHEATS = new CheatManager();
        server = new BridgeServer(CHEATS);
        server.start();

        addWaypointKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.cheatbridge.add_waypoint",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_K,
                "category.cheatbridge"
        ));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            CHEATS.tick(client);
            server.broadcastStateIfChanged(CHEATS);

            if (addWaypointKey != null) {
                while (addWaypointKey.wasPressed()) {
                    CHEATS.addWaypointAtPlayer(client);
                }
            }
        });

        WorldRenderEvents.AFTER_ENTITIES.register(context -> {
            if (CHEATS.esp) EspRenderer.render(context, CHEATS);
            if (CHEATS.tracers) TracerRenderer.render(context, CHEATS);
        });

        WorldRenderEvents.LAST.register(context -> {
            if (CHEATS.waypointsVisible) WaypointRenderer.render(context, CHEATS);
        });

        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> {
            if (server != null) server.stopBridge();
        });
    }
}
