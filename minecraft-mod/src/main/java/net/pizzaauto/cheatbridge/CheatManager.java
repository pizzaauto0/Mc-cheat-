package net.pizzaauto.cheatbridge;

import net.minecraft.client.MinecraftClient;
import net.minecraft.entity.attribute.EntityAttributeInstance;
import net.minecraft.entity.attribute.EntityAttributeModifier;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.Box;
import net.minecraft.world.GameRules;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Haelt den Zustand aller Cheats und wendet sie jeden Client-Tick an.
 *
 * Wichtig: Alle spielrelevanten (nicht rein kosmetischen) Cheats greifen ueber
 * {@code MinecraftClient#getServer()} auf den integrierten Singleplayer-Server zu.
 * Das ist nur nicht-null, wenn der Client gerade selbst eine Welt hostet
 * (Singleplayer / offenes LAN) -- in Multiplayer auf fremden Servern bleiben die
 * spielrelevanten Cheats absichtlich wirkungslos.
 */
public class CheatManager {

    private static final Identifier SPEED_MOD_ID = Identifier.of(CheatBridgeClient.MOD_ID, "speed");
    private static final Identifier BREAK_MOD_ID = Identifier.of(CheatBridgeClient.MOD_ID, "fast_break");

    // --- Toggle-Zustaende ---
    public boolean fly = false;
    public boolean nightVision = false;
    public boolean fullbright = false;
    public boolean esp = false;
    public boolean tracers = false;
    public boolean waypointsVisible = false;
    public boolean keepInventory = false;
    public boolean noFallDamage = false;
    public boolean timeLockDay = false;
    public boolean weatherClear = false;
    public boolean freezeMobs = false;

    // --- Parameter (Slider) ---
    public double speedMultiplier = 2.0;
    public double jumpMultiplier = 2.0;
    public double fastBreakMultiplier = 4.0;

    public final List<Waypoint> waypoints = new ArrayList<>();

    private int tickCounter = 0;
    private boolean freezeMobsWasEnabled = false;
    private Float previousGamma = null;

    // Netzwerk-Nachrichten kommen vom WebSocket-Thread, nicht vom Client-Tick-Thread.
    // Statt Felder direkt aus fremdem Thread zu mutieren, werden Befehle hier
    // eingereiht und beim naechsten tick() auf dem Client-Thread angewendet.
    private final Queue<Runnable> pendingCommands = new ConcurrentLinkedQueue<>();

    public void setCheat(String id, boolean enabled) {
        pendingCommands.add(() -> {
            switch (id) {
                case "fly" -> fly = enabled;
                case "nightVision" -> nightVision = enabled;
                case "fullbright" -> fullbright = enabled;
                case "esp" -> esp = enabled;
                case "tracers" -> tracers = enabled;
                case "waypoints" -> waypointsVisible = enabled;
                case "keepInventory" -> keepInventory = enabled;
                case "noFallDamage" -> noFallDamage = enabled;
                case "timeLockDay" -> timeLockDay = enabled;
                case "weatherClear" -> weatherClear = enabled;
                case "freezeMobs" -> freezeMobs = enabled;
                default -> { /* unbekannte Id ignorieren */ }
            }
        });
    }

    public void setParam(String id, String key, double value) {
        if (!"value".equals(key)) return;
        pendingCommands.add(() -> {
            switch (id) {
                case "speed" -> speedMultiplier = value;
                case "jumpBoost" -> jumpMultiplier = value;
                case "fastBreak" -> fastBreakMultiplier = value;
                default -> { /* unbekannte Id ignorieren */ }
            }
        });
    }

    public void triggerAction(String id) {
        pendingCommands.add(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            ServerPlayerEntity sp = getServerPlayer(client);
            if (sp == null) return;

            switch (id) {
                case "heal" -> sp.setHealth(sp.getMaxHealth());
                case "feed" -> {
                    sp.getHungerManager().setFoodLevel(20);
                    sp.getHungerManager().setSaturationLevel(20.0f);
                }
                default -> { /* unbekannte Aktion ignorieren */ }
            }
        });
    }

    public void addWaypointAtPlayer(MinecraftClient client) {
        if (client.player == null) return;
        var pos = client.player.getPos();
        waypoints.add(new Waypoint("WP " + (waypoints.size() + 1), pos.x, pos.y, pos.z));
    }

    /** Wird jeden Client-Tick aufgerufen. */
    public void tick(MinecraftClient client) {
        tickCounter++;

        Runnable cmd;
        while ((cmd = pendingCommands.poll()) != null) {
            cmd.run();
        }

        ServerPlayerEntity sp = getServerPlayer(client);

        applyFullbright(client);

        if (sp == null) {
            // Nicht im Singleplayer/Host-Modus: keine server-seitigen Cheats anwenden.
            return;
        }

        applyFly(sp);
        applySpeed(sp);
        applyJumpBoost(sp);
        applyNightVision(sp);
        applyFastBreak(sp);
        applyNoFallDamage(sp);
        applyKeepInventory(sp.getServer());
        applyTimeLock(sp.getServer());
        applyWeatherClear(sp.getServer());
        applyFreezeMobs(sp);
    }

    private ServerPlayerEntity getServerPlayer(MinecraftClient client) {
        if (client == null || client.player == null) return null;
        MinecraftServer server = client.getServer();
        if (server == null) return null; // nicht Host einer Singleplayer/LAN-Welt
        return server.getPlayerManager().getPlayer(client.player.getUuid());
    }

    private void applyFly(ServerPlayerEntity sp) {
        var abilities = sp.getAbilities();
        if (fly) {
            if (!abilities.allowFlying) {
                abilities.allowFlying = true;
                sp.sendAbilitiesUpdate();
            }
        } else if (abilities.allowFlying && !sp.isCreative() && !sp.isSpectator()) {
            abilities.allowFlying = false;
            abilities.flying = false;
            sp.sendAbilitiesUpdate();
        }
    }

    private void applySpeed(ServerPlayerEntity sp) {
        EntityAttributeInstance attr = sp.getAttributeInstance(EntityAttributes.MOVEMENT_SPEED);
        if (attr == null) return;
        attr.removeModifier(SPEED_MOD_ID);
        if (speedMultiplier > 1.0) {
            attr.addPersistentModifier(new EntityAttributeModifier(
                    SPEED_MOD_ID, speedMultiplier - 1.0, EntityAttributeModifier.Operation.ADD_MULTIPLIED_TOTAL));
        }
    }

    private void applyJumpBoost(ServerPlayerEntity sp) {
        int amplifier = (int) Math.round(jumpMultiplier) - 1;
        if (amplifier < 0) amplifier = 0;
        sp.addStatusEffect(new StatusEffectInstance(
                StatusEffects.JUMP_BOOST, 60, amplifier, true, false, false));
    }

    private void applyNightVision(ServerPlayerEntity sp) {
        if (nightVision) {
            sp.addStatusEffect(new StatusEffectInstance(
                    StatusEffects.NIGHT_VISION, 300, 0, true, false, false));
        }
    }

    private void applyFullbright(MinecraftClient client) {
        var options = client.options;
        if (options == null) return;
        if (fullbright) {
            if (previousGamma == null) previousGamma = options.getGamma().getValue().floatValue();
            options.getGamma().setValue(100.0);
        } else if (previousGamma != null) {
            options.getGamma().setValue((double) previousGamma);
            previousGamma = null;
        }
    }

    private void applyFastBreak(ServerPlayerEntity sp) {
        EntityAttributeInstance attr = sp.getAttributeInstance(EntityAttributes.PLAYER_BLOCK_BREAK_SPEED);
        if (attr == null) return;
        attr.removeModifier(BREAK_MOD_ID);
        if (fastBreakMultiplier > 1.0) {
            attr.addPersistentModifier(new EntityAttributeModifier(
                    BREAK_MOD_ID, fastBreakMultiplier - 1.0, EntityAttributeModifier.Operation.ADD_MULTIPLIED_TOTAL));
        }
    }

    private void applyNoFallDamage(ServerPlayerEntity sp) {
        if (noFallDamage) {
            sp.fallDistance = 0.0f;
        }
    }

    private void applyKeepInventory(MinecraftServer server) {
        GameRules.BooleanRule rule = server.getGameRules().get(GameRules.KEEP_INVENTORY);
        if (rule.get() != keepInventory) {
            rule.set(keepInventory, server);
        }
    }

    private void applyTimeLock(MinecraftServer server) {
        ServerWorld overworld = server.getOverworld();
        if (overworld == null) return;
        GameRules.BooleanRule daylightCycle = server.getGameRules().get(GameRules.DO_DAYLIGHT_CYCLE);

        if (timeLockDay) {
            if (daylightCycle.get()) daylightCycle.set(false, server);
            if (tickCounter % 20 == 0) overworld.setTimeOfDay(1000L);
        } else if (!daylightCycle.get()) {
            daylightCycle.set(true, server);
        }
    }

    private void applyWeatherClear(MinecraftServer server) {
        ServerWorld overworld = server.getOverworld();
        if (overworld == null) return;
        if (weatherClear && tickCounter % 100 == 0) {
            overworld.setWeather(6000, 0, false, false);
        }
    }

    private void applyFreezeMobs(ServerPlayerEntity sp) {
        if (!freezeMobs && !freezeMobsWasEnabled) return;

        Box area = sp.getBoundingBox().expand(48.0);
        List<MobEntity> mobs = sp.getWorld().getEntitiesByClass(MobEntity.class, area, e -> true);
        for (MobEntity mob : mobs) {
            mob.setAiDisabled(freezeMobs);
        }
        freezeMobsWasEnabled = freezeMobs;
    }

    /** Snapshot fuer die Zustands-Nachricht an die App (JSON-serialisierbar). */
    public Map<String, Object> snapshot() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("fly", fly);
        map.put("nightVision", nightVision);
        map.put("fullbright", fullbright);
        map.put("esp", esp);
        map.put("tracers", tracers);
        map.put("waypoints", waypointsVisible);
        map.put("keepInventory", keepInventory);
        map.put("noFallDamage", noFallDamage);
        map.put("timeLockDay", timeLockDay);
        map.put("weatherClear", weatherClear);
        map.put("freezeMobs", freezeMobs);
        map.put("speed", speedMultiplier);
        map.put("jumpBoost", jumpMultiplier);
        map.put("fastBreak", fastBreakMultiplier);
        return map;
    }
}
