package net.pizzaauto.cheatbridge;

import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BarrelBlockEntity;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.block.entity.AbstractFurnaceBlockEntity;
import net.minecraft.block.entity.ShulkerBoxBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.component.DataComponentTypes;
import net.minecraft.component.type.FoodComponent;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.attribute.EntityAttributeInstance;
import net.minecraft.entity.attribute.EntityAttributeModifier;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.decoration.ArmorStandEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ArmorItem;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.ChunkPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.GameRules;
import net.minecraft.world.chunk.WorldChunk;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
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
    private static final Identifier STEP_MOD_ID = Identifier.of(CheatBridgeClient.MOD_ID, "step_height");
    private static final Identifier KNOCKBACK_MOD_ID = Identifier.of(CheatBridgeClient.MOD_ID, "anti_knockback");

    private static final int WORLD_SCAN_INTERVAL_TICKS = 40; // ~2s
    private static final int WORLD_SCAN_RADIUS_CHUNKS = 3;
    private static final int WORLD_SCAN_Y_RANGE = 24; // Bloecke ueber/unter dem Spieler
    private static final int NUKER_RADIUS = 3;
    private static final List<String> ARMOR_MATERIAL_RANK = List.of(
            "leather", "golden", "chainmail", "iron", "diamond", "netherite");

    private static final Set<String> ORE_ESP_BLOCKS = Set.of(
            "minecraft:diamond_ore", "minecraft:deepslate_diamond_ore",
            "minecraft:emerald_ore", "minecraft:deepslate_emerald_ore",
            "minecraft:ancient_debris",
            "minecraft:gold_ore", "minecraft:deepslate_gold_ore", "minecraft:nether_gold_ore",
            "minecraft:redstone_ore", "minecraft:deepslate_redstone_ore",
            "minecraft:lapis_ore", "minecraft:deepslate_lapis_ore"
    );

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
    public boolean jesus = false;
    public boolean spider = false;
    public boolean step = false;
    public boolean xray = false;
    public boolean storageEsp = false;
    public boolean nuker = false;
    public boolean autoTotem = false;
    public boolean autoEat = false;
    public boolean autoArmor = false;
    public boolean killAura = false;
    public boolean antiKnockback = false;

    // --- Parameter (Slider) ---
    public double speedMultiplier = 2.0;
    public double jumpMultiplier = 2.0;
    public double fastBreakMultiplier = 4.0;
    public double killAuraRange = 4.0;

    public final List<Waypoint> waypoints = new ArrayList<>();

    /** Zwischengespeicherte Fundorte fuer Xray/Storage-ESP, nur periodisch neu gescannt (Performance). */
    public final List<BlockPos> oreEspPositions = new ArrayList<>();
    public final List<BlockPos> storageEspPositions = new ArrayList<>();

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
                case "jesus" -> jesus = enabled;
                case "spider" -> spider = enabled;
                case "step" -> step = enabled;
                case "xray" -> xray = enabled;
                case "storageEsp" -> storageEsp = enabled;
                case "nuker" -> nuker = enabled;
                case "autoTotem" -> autoTotem = enabled;
                case "autoEat" -> autoEat = enabled;
                case "autoArmor" -> autoArmor = enabled;
                case "killAura" -> killAura = enabled;
                case "antiKnockback" -> antiKnockback = enabled;
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
                case "killAuraRange" -> killAuraRange = value;
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
        applyJesus(sp);
        applySpider(sp);
        applyStep(sp);
        applyNuker(sp, client);
        applyAutoTotem(sp);
        applyAutoEat(sp);
        applyAutoArmor(sp);
        applyKillAura(sp);
        applyAntiKnockback(sp);

        if (tickCounter % WORLD_SCAN_INTERVAL_TICKS == 0) {
            scanWorld(sp);
        }
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

    /**
     * Laesst den Spieler auf Wasser laufen statt zu sinken. Vereinfachte Naeherung:
     * bremst das Absinken und schiebt beim Untertauchen leicht Richtung Oberflaeche.
     */
    private void applyJesus(ServerPlayerEntity sp) {
        if (!jesus || !sp.isTouchingWater()) return;

        Vec3d v = sp.getVelocity();
        if (v.y < 0) sp.setVelocity(v.x, 0.0, v.z);
        if (sp.isSubmergedInWater()) {
            sp.setPosition(sp.getX(), sp.getY() + 0.2, sp.getZ());
        }
        sp.fallDistance = 0.0f;
    }

    /** Klettert Waende hoch, solange man sich horizontal in eine Wand hineinbewegt. */
    private void applySpider(ServerPlayerEntity sp) {
        if (!spider || !sp.horizontalCollision) return;

        Vec3d v = sp.getVelocity();
        sp.setVelocity(v.x, 0.2, v.z);
        sp.fallDistance = 0.0f;
    }

    /** Erhoeht die Stufenhoehe auf einen vollen Block, damit man ohne Springen hochsteigt. */
    private void applyStep(ServerPlayerEntity sp) {
        EntityAttributeInstance attr = sp.getAttributeInstance(EntityAttributes.STEP_HEIGHT);
        if (attr == null) return;
        attr.removeModifier(STEP_MOD_ID);
        if (step) {
            attr.addPersistentModifier(new EntityAttributeModifier(
                    STEP_MOD_ID, 0.5, EntityAttributeModifier.Operation.ADD_VALUE));
        }
    }

    /** Baut automatisch abbaubare Bloecke in einem kleinen Radius um den Spieler ab. */
    private void applyNuker(ServerPlayerEntity sp, MinecraftClient client) {
        if (!nuker || tickCounter % 5 != 0) return;

        ServerWorld world = sp.getServerWorld();
        BlockPos center = sp.getBlockPos();

        for (BlockPos pos : BlockPos.iterate(
                center.add(-NUKER_RADIUS, -NUKER_RADIUS, -NUKER_RADIUS),
                center.add(NUKER_RADIUS, NUKER_RADIUS, NUKER_RADIUS))) {
            BlockState state = world.getBlockState(pos);
            if (state.isAir()) continue;
            if (state.getHardness(world, pos) < 0) continue; // unzerstoerbar (z.B. Bedrock)
            world.breakBlock(pos.toImmutable(), true, sp);
        }
    }

    /** Legt ein Totem der Unsterblichkeit ins Offhand, sobald eines im Inventar ist. */
    private void applyAutoTotem(ServerPlayerEntity sp) {
        if (!autoTotem) return;
        if (sp.getOffHandStack().isOf(Items.TOTEM_OF_UNDYING)) return;

        PlayerInventory inv = sp.getInventory();
        for (int i = 0; i < inv.size(); i++) {
            ItemStack stack = inv.getStack(i);
            if (stack.isOf(Items.TOTEM_OF_UNDYING)) {
                ItemStack oldOffhand = sp.getOffHandStack();
                sp.equipStack(EquipmentSlot.OFFHAND, stack.copy());
                inv.setStack(i, oldOffhand);
                break;
            }
        }
    }

    /** Isst automatisch Nahrung aus dem Inventar, wenn der Hunger unter eine Schwelle faellt. */
    private void applyAutoEat(ServerPlayerEntity sp) {
        if (!autoEat || sp.getHungerManager().getFoodLevel() >= 18) return;

        PlayerInventory inv = sp.getInventory();
        for (int i = 0; i < inv.size(); i++) {
            ItemStack stack = inv.getStack(i);
            FoodComponent food = stack.get(DataComponentTypes.FOOD);
            if (food != null) {
                sp.getHungerManager().eat(food.nutrition(), food.saturation());
                stack.decrement(1);
                break;
            }
        }
    }

    /** Ruestet die jeweils beste verfuegbare Ruestung pro Slot aus dem Inventar aus. */
    private void applyAutoArmor(ServerPlayerEntity sp) {
        if (!autoArmor) return;

        PlayerInventory inv = sp.getInventory();
        for (EquipmentSlot slot : new EquipmentSlot[]{
                EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET}) {
            ItemStack equipped = sp.getEquippedStack(slot);
            int bestRank = armorRank(equipped);
            int bestIndex = -1;

            for (int i = 0; i < inv.size(); i++) {
                ItemStack stack = inv.getStack(i);
                if (!(stack.getItem() instanceof ArmorItem armorItem)) continue;
                if (armorItem.getSlotType() != slot) continue;
                int rank = armorRank(stack);
                if (rank > bestRank) {
                    bestRank = rank;
                    bestIndex = i;
                }
            }

            if (bestIndex >= 0) {
                ItemStack better = inv.getStack(bestIndex);
                inv.setStack(bestIndex, equipped);
                sp.equipStack(slot, better);
            }
        }
    }

    private int armorRank(ItemStack stack) {
        if (stack.isEmpty()) return -1;
        String path = Registries.ITEM.getId(stack.getItem()).getPath();
        for (int i = 0; i < ARMOR_MATERIAL_RANK.size(); i++) {
            if (path.contains(ARMOR_MATERIAL_RANK.get(i))) return i;
        }
        return -1;
    }

    /**
     * Greift automatisch das naechste lebende Wesen im Umkreis an -- Spieler sind
     * hart ausgeschlossen (Filter unten), diese Kill Aura wirkt ausschliesslich
     * gegen Mobs und Tiere. Rammt keine Waende (keine Sichtlinienpruefung), das ist
     * eine bewusste Vereinfachung fuer den ersten Wurf.
     */
    private void applyKillAura(ServerPlayerEntity sp) {
        if (!killAura) return;

        Box range = sp.getBoundingBox().expand(killAuraRange);
        LivingEntity target = null;
        double bestDistSq = Double.MAX_VALUE;

        for (LivingEntity entity : sp.getWorld().getEntitiesByClass(LivingEntity.class, range,
                e -> e != sp && e.isAlive() && !(e instanceof PlayerEntity) && !(e instanceof ArmorStandEntity))) {
            double distSq = sp.squaredDistanceTo(entity);
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                target = entity;
            }
        }

        if (target != null) sp.attack(target);
    }

    /**
     * Reduziert erlittenen Rueckstoss ueber das vanilla Attribut knockback_resistance.
     * Achtung: Dieses Attribut unterscheidet nicht zwischen Angreifer-Typen -- es
     * reduziert Rueckstoss durch Mobs UND durch andere Spieler gleichermassen, das
     * laesst sich ohne tiefere Netzwerk-Hooks nicht sauber trennen.
     */
    private void applyAntiKnockback(ServerPlayerEntity sp) {
        EntityAttributeInstance attr = sp.getAttributeInstance(EntityAttributes.KNOCKBACK_RESISTANCE);
        if (attr == null) return;
        attr.removeModifier(KNOCKBACK_MOD_ID);
        if (antiKnockback) {
            attr.addPersistentModifier(new EntityAttributeModifier(
                    KNOCKBACK_MOD_ID, 0.95, EntityAttributeModifier.Operation.ADD_VALUE));
        }
    }

    /**
     * Scannt geladene Chunks im Umkreis periodisch (nicht jeden Tick, aus Performance-
     * Gruenden) nach Erzen (Xray) und Containern (Storage-ESP) und puffert die Treffer
     * fuer die Render-Klassen.
     */
    private void scanWorld(ServerPlayerEntity sp) {
        if (!xray) oreEspPositions.clear();
        if (!storageEsp) storageEspPositions.clear();
        if (!xray && !storageEsp) return;

        ServerWorld world = sp.getServerWorld();
        ChunkPos center = sp.getChunkPos();

        List<BlockPos> newOres = xray ? new ArrayList<>() : null;
        List<BlockPos> newStorage = storageEsp ? new ArrayList<>() : null;

        for (int cx = -WORLD_SCAN_RADIUS_CHUNKS; cx <= WORLD_SCAN_RADIUS_CHUNKS; cx++) {
            for (int cz = -WORLD_SCAN_RADIUS_CHUNKS; cz <= WORLD_SCAN_RADIUS_CHUNKS; cz++) {
                WorldChunk chunk = world.getChunk(center.x + cx, center.z + cz);
                if (chunk == null) continue;

                if (storageEsp) {
                    for (Map.Entry<BlockPos, BlockEntity> entry : chunk.getBlockEntities().entrySet()) {
                        BlockEntity be = entry.getValue();
                        if (be instanceof ChestBlockEntity || be instanceof BarrelBlockEntity
                                || be instanceof ShulkerBoxBlockEntity || be instanceof AbstractFurnaceBlockEntity) {
                            newStorage.add(entry.getKey().toImmutable());
                        }
                    }
                }

                if (xray) {
                    int minY = Math.max(world.getBottomY(), sp.getBlockY() - WORLD_SCAN_Y_RANGE);
                    int maxY = Math.min(world.getTopYInclusive(), sp.getBlockY() + WORLD_SCAN_Y_RANGE);
                    for (int x = 0; x < 16; x++) {
                        for (int z = 0; z < 16; z++) {
                            for (int y = minY; y <= maxY; y++) {
                                BlockPos pos = new BlockPos(chunk.getPos().getStartX() + x, y, chunk.getPos().getStartZ() + z);
                                BlockState state = chunk.getBlockState(pos);
                                if (state.isAir()) continue;
                                String id = Registries.BLOCK.getId(state.getBlock()).toString();
                                if (ORE_ESP_BLOCKS.contains(id)) newOres.add(pos);
                            }
                        }
                    }
                }
            }
        }

        if (xray) {
            oreEspPositions.clear();
            oreEspPositions.addAll(newOres);
        }
        if (storageEsp) {
            storageEspPositions.clear();
            storageEspPositions.addAll(newStorage);
        }
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
        map.put("jesus", jesus);
        map.put("spider", spider);
        map.put("step", step);
        map.put("xray", xray);
        map.put("storageEsp", storageEsp);
        map.put("nuker", nuker);
        map.put("autoTotem", autoTotem);
        map.put("autoEat", autoEat);
        map.put("autoArmor", autoArmor);
        map.put("killAura", killAura);
        map.put("antiKnockback", antiKnockback);
        map.put("speed", speedMultiplier);
        map.put("jumpBoost", jumpMultiplier);
        map.put("fastBreak", fastBreakMultiplier);
        map.put("killAuraRange", killAuraRange);
        return map;
    }
}
