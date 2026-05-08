"use client";

import { useEffect, useRef, useState } from "react";
import { Application, BlurFilter, Container, Graphics, Text, TextStyle } from "pixi.js";
import { io } from "socket.io-client";

const GOODS = {
  diamonds: { label: "Diamonds", color: 0xd94f70, icon: "◆" },
  gold: { label: "Gold", color: 0xe2a93b, icon: "●" },
  silver: { label: "Silver", color: 0xa6b8cf, icon: "◐" },
  cloth: { label: "Cloth", color: 0x42b4d6, icon: "▧" },
  spice: { label: "Spice", color: 0xd86e33, icon: "✦" },
  leather: { label: "Leather", color: 0xa26a46, icon: "⬟" },
  camel: { label: "Camel", color: 0xc89a4b, icon: "♞" }
};

const DISPLAY_FONT = "Palatino Linotype";
const UI_FONT = "Trebuchet MS";
const SETTINGS_KEY = "jaipur.settings.v2";

const DEFAULT_SETTINGS = {
  musicEnabled: true,
  musicVolume: 0.5,
  sfxEnabled: true,
  sfxVolume: 0.75,
  reducedMotion: false,
  musicTrack: "desert"
};

const AUDIO_TRACKS = {
  desert: {
    alias: "music-desert",
    label: "Desert Travel",
    url: "/audio/music/desert-travel.ogg"
  },
  market: {
    alias: "music-market",
    label: "Market Day",
    url: "/audio/music/market-day.mp3"
  }
};

const SFX = {
  tap: { alias: "sfx-tap", url: "/audio/sfx/tap.wav", gain: 0.55 },
  card: { alias: "sfx-card", url: "/audio/sfx/card-select.wav", gain: 0.55 },
  good: { alias: "sfx-good", url: "/audio/sfx/confirm.wav", gain: 0.75 },
  bad: { alias: "sfx-bad", url: "/audio/sfx/error.wav", gain: 0.7 },
  start: { alias: "sfx-open", url: "/audio/sfx/panel-open.wav", gain: 0.75 },
  close: { alias: "sfx-close", url: "/audio/sfx/panel-close.wav", gain: 0.75 },
  sell: { alias: "sfx-sell", url: "/audio/sfx/sell.wav", gain: 0.8 }
};

const AUDIO_CREDITS = [
  "Kenney Interface Sounds (CC0) for UI taps, confirmations, and panel actions.",
  "Desert Travel (Loop) by DJ CrisP (CC0) for the roaming bazaar ambience.",
  "Medieval: Market Day by RandomMind (CC0) for the upbeat trading-floor loop."
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function loadStoredSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      ...DEFAULT_SETTINGS,
      ...parsed
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveStoredSettings(settings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function createAudioManager() {
  return {
    lib: null,
    ready: false,
    unlocked: false,
    musicAlias: null,
    musicInstance: null,

    async getLib() {
      if (typeof window === "undefined") return null;
      if (this.lib) return this.lib;
      const module = await import("@pixi/sound");
      this.lib = module.sound;
      return this.lib;
    },

    async load() {
      if (this.ready) return;
      const lib = await this.getLib();
      if (!lib) return;
      Object.values(SFX).forEach((entry) => {
        if (!lib.exists(entry.alias)) lib.add(entry.alias, entry.url);
      });
      Object.values(AUDIO_TRACKS).forEach((entry) => {
        if (!lib.exists(entry.alias)) lib.add(entry.alias, entry.url);
      });
      this.ready = true;
    },

    async prime() {
      if (typeof window === "undefined") return;
      await this.load();
      this.unlocked = true;
      const lib = await this.getLib();
      const audioContext = lib?.context?.audioContext;
      if (audioContext?.state === "suspended") {
        try {
          await audioContext.resume();
        } catch {
          return;
        }
      }
    },

    async play(kind, settings) {
      if (!settings.sfxEnabled) return;
      const entry = SFX[kind];
      if (!entry) return;
      await this.prime();
      const lib = await this.getLib();
      if (!lib) return;
      try {
        lib.play(entry.alias, {
          singleInstance: false,
          volume: clamp(settings.sfxVolume * entry.gain, 0, 1)
        });
      } catch {}
    },

    stopMusic() {
      const lib = this.lib;
      if (!lib) return;
      if (!this.musicAlias) return;
      if (lib.exists(this.musicAlias)) lib.stop(this.musicAlias);
      this.musicAlias = null;
      this.musicInstance = null;
    },

    async syncMusic(settings) {
      await this.load();
      const lib = await this.getLib();
      if (!lib) return;
      const track = AUDIO_TRACKS[settings.musicTrack] || AUDIO_TRACKS.desert;
      const targetVolume = clamp(settings.musicVolume * 0.52, 0, 1);

      if (!this.unlocked || !settings.musicEnabled || targetVolume <= 0) {
        this.stopMusic();
        return;
      }

      if (this.musicAlias !== track.alias) {
        this.stopMusic();
        this.musicAlias = track.alias;
        try {
          this.musicInstance = await Promise.resolve(lib.play(track.alias, {
            loop: true,
            singleInstance: true,
            volume: targetVolume
          }));
        } catch {
          this.musicInstance = null;
        }
        return;
      }

      if (this.musicInstance?.set) this.musicInstance.set("volume", targetVolume);
      else lib.volume(track.alias, targetVolume);
    },

    destroy() {
      this.stopMusic();
      this.lib?.stopAll();
    }
  };
}

function createText(root, text, x, y, styleOptions, anchorX = 0, anchorY = 0) {
  const node = new Text({
    text,
    style: new TextStyle(styleOptions)
  });
  node.anchor.set(anchorX, anchorY);
  node.position.set(x, y);
  root.addChild(node);
  return node;
}

function createPanel(root, x, y, width, height, title, compact = false) {
  const holder = new Container();
  holder.position.set(x, y);
  holder.__panelWidth = width;
  holder.__panelHeight = height;

  const shadow = new Graphics().roundRect(10, 12, width, height, compact ? 24 : 30).fill({ color: 0x120d0b, alpha: 0.28 });
  shadow.filters = [new BlurFilter({ strength: 10, quality: 2 })];
  holder.addChild(shadow);

  holder.addChild(
    new Graphics()
      .roundRect(0, 0, width, height, compact ? 24 : 30)
      .fill({ color: 0x2a1b16, alpha: 0.84 })
      .stroke({ color: 0xf0cc88, width: 2, alpha: 0.28 })
  );

  if (title) {
    createText(holder, title, 20, compact ? 14 : 16, {
      fill: 0xf3ddb1,
      fontFamily: DISPLAY_FONT,
      fontSize: compact ? 20 : 24,
      fontWeight: "700",
      letterSpacing: 1.1
    });
  }

  root.addChild(holder);
  return holder;
}

function buttonColors(variant, disabled) {
  if (disabled) return { fill: 0x5b4d46, label: 0xcdc0b0, glow: 0x000000 };
  const palette = {
    primary: { fill: 0xdd9f32, label: 0x24170d, glow: 0xf5ce71 },
    accent: { fill: 0x2c8c8a, label: 0xf4fbfb, glow: 0x5ec3be },
    danger: { fill: 0x9f3b39, label: 0xffefec, glow: 0xd86a67 },
    ghost: { fill: 0x382c28, label: 0xf1e1c7, glow: 0xb3813d }
  };
  return palette[variant] || palette.primary;
}

function createButton(root, scene, options) {
  const {
    x,
    y,
    width,
    height,
    label,
    onTap,
    disabled = false,
    variant = "primary",
    size = 18,
    soundKind = "tap"
  } = options;

  const palette = buttonColors(variant, disabled);
  const holder = new Container();
  holder.position.set(x, y);

  const glow = new Graphics().roundRect(-2, -2, width + 4, height + 4, 18).fill({ color: palette.glow, alpha: disabled ? 0.08 : 0.18 });
  glow.filters = [new BlurFilter({ strength: 6, quality: 2 })];
  holder.addChild(glow);

  const button = new Graphics()
    .roundRect(0, 0, width, height, 16)
    .fill(palette.fill)
    .stroke({ color: 0xf3dfb1, width: disabled ? 1 : 2, alpha: disabled ? 0.22 : 0.55 });
  holder.addChild(button);

  const caption = createText(holder, label, width / 2, height / 2, {
    fill: palette.label,
    fontFamily: UI_FONT,
    fontWeight: "700",
    fontSize: size,
    align: "center"
  }, 0.5, 0.5);

  holder.eventMode = "static";
  holder.cursor = disabled ? "default" : "pointer";
  holder.alpha = disabled ? 0.64 : 1;
  holder.__hover = 0;
  holder.__pulse = 0;

  if (!disabled) {
    holder.on("pointerover", () => {
      holder.__hover = 1;
    });
    holder.on("pointerout", () => {
      holder.__hover = 0;
    });
    holder.on("pointertap", () => {
      scene.onSound(soundKind);
      onTap?.();
    });
  }

  scene.updaters.push((time) => {
    const motion = scene.motionScale;
    holder.__pulse = lerp(holder.__pulse, holder.__hover, 0.14);
    const pulse = 1 + holder.__pulse * 0.03 * motion + Math.sin(time / 480) * 0.004 * motion;
    holder.scale.set(pulse);
    glow.alpha = disabled ? 0.08 : 0.16 + holder.__pulse * 0.18;
    caption.alpha = disabled ? 0.75 : 1;
  });

  root.addChild(holder);
  return holder;
}

function createChip(root, x, y, width, height, label, value, compact = false) {
  const chip = new Graphics()
    .roundRect(x, y, width, height, 18)
    .fill({ color: 0x2d2420, alpha: 0.62 })
    .stroke({ color: 0xf0cc88, width: 1.5, alpha: 0.18 });
  root.addChild(chip);

  createText(root, label, x + 14, y + 10, {
    fill: 0xcdb392,
    fontFamily: UI_FONT,
    fontSize: compact ? 11 : 12,
    fontWeight: "700",
    letterSpacing: 0.6
  });
  createText(root, value, x + 14, y + height - (compact ? 15 : 16), {
    fill: 0xf8ebd1,
    fontFamily: DISPLAY_FONT,
    fontSize: compact ? 19 : 22,
    fontWeight: "700"
  });
}

function layoutCardStrip(count, availableWidth, idealWidth, minWidth, minVisibleRatio = 0.62) {
  if (count <= 0) return { cardWidth: idealWidth, stride: idealWidth + 12, totalWidth: 0 };

  let cardWidth = Math.min(idealWidth, Math.floor(availableWidth / count));
  cardWidth = Math.max(minWidth, cardWidth);
  let stride = count === 1 ? 0 : Math.floor((availableWidth - cardWidth) / (count - 1));
  stride = Math.min(cardWidth + 14, stride);

  const minimumVisible = Math.floor(cardWidth * minVisibleRatio);
  if (count > 1 && stride < minimumVisible) {
    cardWidth = Math.max(minWidth, Math.floor(availableWidth / (1 + (count - 1) * minVisibleRatio)));
    stride = Math.floor((availableWidth - cardWidth) / (count - 1));
  }

  return {
    cardWidth,
    stride: count === 1 ? 0 : stride,
    totalWidth: count === 1 ? cardWidth : cardWidth + stride * (count - 1)
  };
}

function createCard(root, scene, options) {
  const { card, x, y, width, height, selected, area, onTap, compact = false, index = 0 } = options;
  const meta = GOODS[card.type];
  const holder = new Container();
  holder.position.set(x, y);
  holder.eventMode = "static";
  holder.cursor = "pointer";
  holder.__hover = 0;

  const entrance = scene.cardEntrances.get(card.id) || performance.now() + index * 28;
  scene.cardEntrances.set(card.id, entrance);

  const halo = new Graphics().roundRect(-7, -7, width + 14, height + 14, compact ? 18 : 24).fill({ color: meta.color, alpha: selected ? 0.2 : 0 });
  halo.filters = [new BlurFilter({ strength: 8, quality: 2 })];
  holder.addChild(halo);

  holder.addChild(
    new Graphics()
      .roundRect(0, 0, width, height, compact ? 18 : 22)
      .fill(0xfaf0d6)
      .stroke({ color: meta.color, width: selected ? 4 : 2.5, alpha: 0.94 })
  );

  holder.addChild(
    new Graphics()
      .roundRect(12, 12, width - 24, compact ? 26 : 32, 12)
      .fill({ color: meta.color, alpha: 0.14 })
  );

  holder.addChild(
    new Graphics()
      .roundRect(width - (compact ? 38 : 44), 12, compact ? 26 : 30, compact ? 26 : 30, 10)
      .fill({ color: meta.color, alpha: 0.94 })
  );

  createText(holder, meta.icon, width - (compact ? 25 : 29), compact ? 25 : 27, {
    fill: 0xfff9ef,
    fontFamily: DISPLAY_FONT,
    fontWeight: "700",
    fontSize: compact ? 16 : 19
  }, 0.5, 0.5);

  createText(holder, meta.label.toUpperCase(), 18, compact ? 24 : 28, {
    fill: 0x2d211a,
    fontFamily: UI_FONT,
    fontWeight: "800",
    fontSize: compact ? 10 : 12,
    letterSpacing: 0.9
  }, 0, 0.5);

  createText(holder, meta.icon, width / 2, compact ? height * 0.45 : height * 0.46, {
    fill: meta.color,
    fontFamily: DISPLAY_FONT,
    fontWeight: "700",
    fontSize: compact ? Math.floor(width * 0.36) : Math.floor(width * 0.42)
  }, 0.5, 0.5);

  createText(holder, selected ? "READY" : area === "market" ? "MARKET" : area === "hand" ? "HAND" : "HERD", width / 2, height - (compact ? 18 : 22), {
    fill: selected ? 0x115756 : 0x8a6d5d,
    fontFamily: UI_FONT,
    fontWeight: "800",
    fontSize: compact ? 9 : 10,
    letterSpacing: 1.2
  }, 0.5, 0.5);

  holder.on("pointerover", () => {
    holder.__hover = 1;
  });
  holder.on("pointerout", () => {
    holder.__hover = 0;
  });
  holder.on("pointertap", () => {
    scene.onSound("card");
    onTap?.();
  });

  scene.updaters.push((time) => {
    const motion = scene.motionScale;
    const elapsed = clamp((time - entrance) / (scene.reduceMotion ? 120 : 260), 0, 1);
    const eased = 1 - (1 - elapsed) * (1 - elapsed);
    const hover = holder.__hover ? 1 : 0;
    holder.y = y + (1 - eased) * 18 * motion - hover * 7 * motion;
    holder.alpha = elapsed;
    holder.rotation = (1 - eased) * -0.05 * motion;
    holder.scale.set(1 + hover * 0.03 * motion + Math.sin(time / 600 + index) * 0.004 * motion);
    halo.alpha = selected ? 0.16 + Math.sin(time / 350 + index) * 0.04 * motion : hover * 0.12;
  });

  root.addChild(holder);
  return holder;
}

function buildBackground(root, scene, width, height, compact) {
  const backdrop = new Container();
  root.addChild(backdrop);

  backdrop.addChild(new Graphics().rect(0, 0, width, height).fill(0x140d0d));
  backdrop.addChild(new Graphics().rect(0, 0, width, height * 0.38).fill(0x61211c));
  backdrop.addChild(new Graphics().rect(0, height * 0.38, width, height * 0.3).fill(0x84502f));
  backdrop.addChild(new Graphics().rect(0, height * 0.68, width, height * 0.32).fill(0x3e241b));

  const sun = new Graphics().circle(width * 0.82, height * 0.16, Math.max(120, width * 0.08)).fill({ color: 0xf7d07a, alpha: 0.14 });
  sun.filters = [new BlurFilter({ strength: 28, quality: 2 })];
  backdrop.addChild(sun);

  const table = new Graphics()
    .roundRect(width * 0.08, height * 0.15, width * 0.84, height * 0.74, compact ? 28 : 40)
    .fill({ color: 0x1d5348, alpha: 0.96 })
    .stroke({ color: 0xe9c680, width: 3, alpha: 0.3 });
  backdrop.addChild(table);

  const rug = new Graphics()
    .roundRect(width * 0.12, height * 0.2, width * 0.76, height * 0.64, compact ? 22 : 30)
    .fill({ color: 0x133530, alpha: 0.84 })
    .stroke({ color: 0x88d1bc, width: 2, alpha: 0.2 });
  backdrop.addChild(rug);

  const particleCount = compact ? 10 : 18;
  for (let index = 0; index < particleCount; index += 1) {
    const particle = new Graphics().circle(0, 0, 2 + (index % 3)).fill({ color: 0xf6d27e, alpha: 0.45 });
    particle.x = Math.random() * width;
    particle.y = Math.random() * height;
    particle.__speed = 0.08 + Math.random() * 0.14;
    particle.__drift = Math.random() * 0.6;
    backdrop.addChild(particle);
    scene.updaters.push((time) => {
      if (scene.reduceMotion) {
        particle.alpha = 0.12;
        return;
      }
      particle.y -= particle.__speed;
      particle.x += Math.sin(time / 800 + index) * particle.__drift * 0.08;
      if (particle.y < -20) {
        particle.y = height + 20;
        particle.x = Math.random() * width;
      }
      particle.alpha = 0.2 + Math.sin(time / 520 + index) * 0.18;
    });
  }
}

function getViewportMetrics(width, height) {
  const portrait = height > width;
  const compact = width < 920 || height < 720;
  const phone = width < 640 || height < 760;
  const wide = width / height > 1.6;
  const pad = clamp(Math.min(width, height) * 0.026, 14, 28);
  const headerHeight = portrait ? (phone ? 118 : 126) : (compact ? 96 : 108);
  return {
    width,
    height,
    portrait,
    compact,
    phone,
    wide,
    pad,
    headerHeight
  };
}

function toggleSelectionSet(list, id) {
  return list.includes(id)
    ? list.filter((entry) => entry !== id)
    : [...list, id];
}

function getResultText(game, me) {
  if (!game) return "";
  if (game.status !== "finished") return "";
  if (game.winnerId === me?.id) return `You win. ${game.finalReason}`;
  if (game.winnerId) {
    const winner = game.players.find((player) => player.id === game.winnerId);
    return `${winner?.name || "Opponent"} wins. ${game.finalReason}`;
  }
  return `Tie game. ${game.finalReason}`;
}

function renderHeader(root, scene, state, metrics, title, subtitle, chips = []) {
  const header = createPanel(root, metrics.pad, metrics.pad, metrics.width - metrics.pad * 2, metrics.headerHeight, "", metrics.compact);
  createText(header, title, 20, 16, {
    fill: 0xf6dfb0,
    fontFamily: DISPLAY_FONT,
    fontSize: metrics.compact ? 28 : 34,
    fontWeight: "700",
    letterSpacing: 2.2
  });
  createText(header, subtitle, 22, metrics.compact ? 52 : 60, {
    fill: 0xe7c388,
    fontFamily: UI_FONT,
    fontSize: metrics.compact ? 13 : 15,
    fontWeight: "700",
    wordWrap: true,
    wordWrapWidth: metrics.width - metrics.pad * 2 - 220
  });

  const buttonWidth = metrics.phone ? 72 : 92;
  createButton(header, scene, {
    x: metrics.width - metrics.pad * 2 - buttonWidth - 16,
    y: 18,
    width: buttonWidth,
    height: 42,
    label: "Settings",
    variant: "ghost",
    size: metrics.phone ? 11 : 13,
    soundKind: "start",
    onTap: state.onOpenSettings
  });

  if (!chips.length) return header;

  const chipWidth = metrics.phone ? 98 : 126;
  const chipHeight = metrics.phone ? 50 : 56;
  const gap = 12;
  let chipX = metrics.phone ? 18 : 20;
  const chipY = metrics.compact ? metrics.headerHeight - chipHeight - 12 : metrics.headerHeight - chipHeight - 14;
  chips.forEach((chip) => {
    createChip(header, chipX, chipY, chipWidth, chipHeight, chip.label, chip.value, metrics.phone);
    chipX += chipWidth + gap;
  });

  return header;
}

function renderAuthScene(scene, state, metrics) {
  buildBackground(scene.root, scene, metrics.width, metrics.height, metrics.compact);
  renderHeader(scene.root, scene, state, metrics, "JAIPUR", "Merchant duel in a living bazaar.");

  const panelWidth = Math.min(metrics.width - metrics.pad * 2, metrics.phone ? 360 : 540);
  const panelHeight = metrics.phone ? 420 : 438;
  const panelX = (metrics.width - panelWidth) / 2;
  const panelY = metrics.pad + metrics.headerHeight + metrics.pad + Math.max(0, (metrics.height - metrics.headerHeight - panelHeight - metrics.pad * 3) * 0.18);
  const panel = createPanel(scene.root, panelX, panelY, panelWidth, panelHeight, state.mode === "login" ? "Enter The Market" : "Open A Trader Account", metrics.compact);

  createText(panel, "PixiJS canvas board, realtime tables, and an adaptive layout tuned for desktop and phone play.", 20, 52, {
    fill: 0xc9b89f,
    fontFamily: UI_FONT,
    fontSize: metrics.phone ? 13 : 15,
    wordWrap: true,
    wordWrapWidth: panelWidth - 40
  });

  const fieldWidth = panelWidth - 40;
  createButton(panel, scene, {
    x: 20,
    y: 108,
    width: fieldWidth,
    height: 62,
    label: `Name: ${state.authDraft.name || "Tap to set player name"}`,
    variant: "ghost",
    size: metrics.phone ? 15 : 17,
    onTap: () => {
      const nextValue = window.prompt("Player name", state.authDraft.name);
      if (nextValue !== null) state.setAuthDraft((current) => ({ ...current, name: nextValue.trim().slice(0, 24) }));
    }
  });

  createButton(panel, scene, {
    x: 20,
    y: 186,
    width: fieldWidth,
    height: 62,
    label: `Password: ${state.authDraft.password ? "•".repeat(Math.min(state.authDraft.password.length, 10)) : "Tap to set password"}`,
    variant: "ghost",
    size: metrics.phone ? 15 : 17,
    onTap: () => {
      const nextValue = window.prompt("Password", state.authDraft.password);
      if (nextValue !== null) state.setAuthDraft((current) => ({ ...current, password: nextValue }));
    }
  });

  const splitWidth = Math.floor((fieldWidth - 12) / 2);
  createButton(panel, scene, {
    x: 20,
    y: 266,
    width: splitWidth,
    height: 58,
    label: "Login",
    variant: state.mode === "login" ? "accent" : "ghost",
    onTap: () => state.setMode("login")
  });

  createButton(panel, scene, {
    x: 32 + splitWidth,
    y: 266,
    width: splitWidth,
    height: 58,
    label: "Register",
    variant: state.mode === "register" ? "accent" : "ghost",
    onTap: () => state.setMode("register")
  });

  createButton(panel, scene, {
    x: 20,
    y: 338,
    width: fieldWidth,
    height: 62,
    label: state.mode === "login" ? "Enter Bazaar" : "Create Trader",
    variant: "primary",
    soundKind: "start",
    onTap: state.onAuthSubmit
  });

  createText(panel, state.authError || "Accounts stay in memory unless DATABASE_URL is configured. Audio starts after the first interaction.", 20, panelHeight - 28, {
    fill: state.authError ? 0xf6aaa4 : 0xb7aa97,
    fontFamily: UI_FONT,
    fontSize: metrics.phone ? 11 : 12,
    wordWrap: true,
    wordWrapWidth: panelWidth - 40
  });
}

function renderLobbyScene(scene, state, metrics) {
  buildBackground(scene.root, scene, metrics.width, metrics.height, metrics.compact);
  renderHeader(scene.root, scene, state, metrics, "Jaipur Merchant Hall", `Trader ${state.me.name} · ${state.persistence === "memory" ? "session memory" : "postgres session store"}`);

  const bodyY = metrics.pad * 2 + metrics.headerHeight;
  const bodyHeight = metrics.height - bodyY - metrics.pad;

  if (metrics.portrait) {
    const topHeight = Math.min(470, bodyHeight * 0.66);
    const hero = createPanel(scene.root, metrics.pad, bodyY, metrics.width - metrics.pad * 2, topHeight, "Start A Match", metrics.compact);
    createText(hero, "Choose a live match or a bot difficulty, then open the session. The canvas layout adapts between wide desktop tables and portrait phone play.", 20, 54, {
      fill: 0xc9b89f,
      fontFamily: UI_FONT,
      fontSize: metrics.phone ? 13 : 14,
      wordWrap: true,
      wordWrapWidth: metrics.width - metrics.pad * 2 - 40
    });

    const heroWidth = metrics.width - metrics.pad * 2 - 40;
    createText(hero, `Mode: ${state.matchSetup.mode === "singleplayer" ? "Single Player" : "Multiplayer"}`, 20, 102, {
      fill: 0xf1ddb5,
      fontFamily: DISPLAY_FONT,
      fontSize: 18,
      fontWeight: "700"
    });
    createButton(hero, scene, {
      x: 20,
      y: 130,
      width: Math.floor((heroWidth - 10) / 2),
      height: 48,
      label: "Multiplayer",
      variant: state.matchSetup.mode === "multiplayer" ? "accent" : "ghost",
      onTap: () => state.setMatchSetup((current) => ({ ...current, mode: "multiplayer" }))
    });
    createButton(hero, scene, {
      x: 30 + Math.floor((heroWidth - 10) / 2),
      y: 130,
      width: Math.floor((heroWidth - 10) / 2),
      height: 48,
      label: "Single Player",
      variant: state.matchSetup.mode === "singleplayer" ? "accent" : "ghost",
      onTap: () => state.setMatchSetup((current) => ({ ...current, mode: "singleplayer" }))
    });
    createText(hero, `Bot: ${state.matchSetup.difficulty[0].toUpperCase()}${state.matchSetup.difficulty.slice(1)}`, 20, 192, {
      fill: 0xf1ddb5,
      fontFamily: DISPLAY_FONT,
      fontSize: 18,
      fontWeight: "700"
    });
    ["easy", "medium", "hard"].forEach((difficulty, index) => {
      const width = Math.floor((heroWidth - 20) / 3);
      createButton(hero, scene, {
        x: 20 + index * (width + 10),
        y: 220,
        width,
        height: 46,
        label: difficulty[0].toUpperCase() + difficulty.slice(1),
        variant: state.matchSetup.difficulty === difficulty ? "accent" : "ghost",
        disabled: state.matchSetup.mode !== "singleplayer",
        onTap: () => state.setMatchSetup((current) => ({ ...current, difficulty }))
      });
    });

    createButton(hero, scene, {
      x: 20,
      y: 286,
      width: heroWidth,
      height: 56,
      label: state.matchSetup.mode === "singleplayer" ? "Play Vs Bot" : "Open Session",
      variant: "primary",
      soundKind: "start",
      onTap: state.onCreateGame
    });

    createButton(hero, scene, {
      x: 20,
      y: 354,
      width: heroWidth,
      height: 56,
      label: "Copy Invite Link",
      variant: "accent",
      disabled: !state.game || state.game.mode === "singleplayer",
      onTap: state.onCopyInvite
    });

    createButton(hero, scene, {
      x: 20,
      y: 422,
      width: heroWidth,
      height: 48,
      label: "Logout",
      variant: "danger",
      onTap: state.onLogout
    });

    const showcaseY = bodyY + topHeight + metrics.pad;
    const showcaseHeight = metrics.height - showcaseY - metrics.pad;
    const showcase = createPanel(scene.root, metrics.pad, showcaseY, metrics.width - metrics.pad * 2, showcaseHeight, "Table Preview", metrics.compact);
    createText(showcase, state.game ? (state.game.mode === "singleplayer" ? "Single-player sessions stay local to this browser login." : `Invite: ${state.inviteUrl}`) : "Open a session to reveal the invite route.", 20, 54, {
      fill: 0xe8d7b5,
      fontFamily: UI_FONT,
      fontSize: 12,
      wordWrap: true,
      wordWrapWidth: metrics.width - metrics.pad * 2 - 40
    });
    createText(showcase, state.joinHint, 20, 88, {
      fill: 0xb7aa97,
      fontFamily: UI_FONT,
      fontSize: 11,
      wordWrap: true,
      wordWrapWidth: metrics.width - metrics.pad * 2 - 40
    });

    const cardLayout = layoutCardStrip(4, metrics.width - metrics.pad * 2 - 64, 132, 88, 0.76);
    ["diamonds", "gold", "cloth", "camel"].forEach((type, index) => {
      createCard(showcase, scene, {
        card: { id: `preview-${type}`, type },
        x: 24 + index * cardLayout.stride,
        y: 134 + (index % 2) * 22,
        width: cardLayout.cardWidth,
        height: Math.floor(cardLayout.cardWidth * 1.42),
        selected: index === 1,
        area: "market",
        compact: cardLayout.cardWidth < 112,
        index,
        onTap: () => {}
      });
    });
    return;
  }

  const heroWidth = Math.min(448, metrics.width * 0.38);
  const hero = createPanel(scene.root, metrics.pad, bodyY, heroWidth, bodyHeight, "Start A Match", metrics.compact);
  createText(hero, "Choose live multiplayer or a computer trader. The board scales cleanly from 16:9 to phone-sized layouts.", 20, 54, {
    fill: 0xc9b89f,
    fontFamily: UI_FONT,
    fontSize: 14,
    wordWrap: true,
    wordWrapWidth: heroWidth - 40
  });
  createText(hero, `Mode: ${state.matchSetup.mode === "singleplayer" ? "Single Player" : "Multiplayer"}`, 20, 102, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: 20,
    fontWeight: "700"
  });
  createButton(hero, scene, {
    x: 20,
    y: 132,
    width: Math.floor((heroWidth - 50) / 2),
    height: 50,
    label: "Multiplayer",
    variant: state.matchSetup.mode === "multiplayer" ? "accent" : "ghost",
    onTap: () => state.setMatchSetup((current) => ({ ...current, mode: "multiplayer" }))
  });
  createButton(hero, scene, {
    x: 30 + Math.floor((heroWidth - 50) / 2),
    y: 132,
    width: Math.floor((heroWidth - 50) / 2),
    height: 50,
    label: "Single Player",
    variant: state.matchSetup.mode === "singleplayer" ? "accent" : "ghost",
    onTap: () => state.setMatchSetup((current) => ({ ...current, mode: "singleplayer" }))
  });
  createText(hero, `Bot Difficulty: ${state.matchSetup.difficulty[0].toUpperCase()}${state.matchSetup.difficulty.slice(1)}`, 20, 202, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: 20,
    fontWeight: "700"
  });
  ["easy", "medium", "hard"].forEach((difficulty, index) => {
    const width = Math.floor((heroWidth - 60) / 3);
    createButton(hero, scene, {
      x: 20 + index * (width + 10),
      y: 232,
      width,
      height: 48,
      label: difficulty[0].toUpperCase() + difficulty.slice(1),
      variant: state.matchSetup.difficulty === difficulty ? "accent" : "ghost",
      disabled: state.matchSetup.mode !== "singleplayer",
      onTap: () => state.setMatchSetup((current) => ({ ...current, difficulty }))
    });
  });

  createButton(hero, scene, {
    x: 20,
    y: 296,
    width: heroWidth - 40,
    height: 64,
    label: state.matchSetup.mode === "singleplayer" ? "Play Vs Bot" : "Open Session",
    variant: "primary",
    soundKind: "start",
    onTap: state.onCreateGame
  });
  createButton(hero, scene, {
    x: 20,
    y: 374,
    width: heroWidth - 40,
    height: 64,
    label: "Copy Invite Link",
    variant: "accent",
    disabled: !state.game || state.game.mode === "singleplayer",
    onTap: state.onCopyInvite
  });
  createButton(hero, scene, {
    x: 20,
    y: 452,
    width: heroWidth - 40,
    height: 56,
    label: "Logout",
    variant: "danger",
    onTap: state.onLogout
  });

  createText(hero, state.game ? (state.game.mode === "singleplayer" ? "Single-player sessions stay local to this browser login." : `Invite: ${state.inviteUrl}`) : "Open a session to reveal the invite route.", 20, 530, {
    fill: 0xe8d7b5,
    fontFamily: UI_FONT,
    fontSize: 13,
    wordWrap: true,
    wordWrapWidth: heroWidth - 40
  });
  createText(hero, state.joinHint, 20, 580, {
    fill: 0xb7aa97,
    fontFamily: UI_FONT,
    fontSize: 12,
    wordWrap: true,
    wordWrapWidth: heroWidth - 40
  });

  const showcaseX = metrics.pad * 2 + heroWidth;
  const showcaseWidth = metrics.width - showcaseX - metrics.pad;
  const showcase = createPanel(scene.root, showcaseX, bodyY, showcaseWidth, bodyHeight, "Table Preview", metrics.compact);
  const cardLayout = layoutCardStrip(4, showcaseWidth - 84, 140, 102, 0.78);
  ["diamonds", "gold", "cloth", "camel"].forEach((type, index) => {
    createCard(showcase, scene, {
      card: { id: `preview-${type}`, type },
      x: 32 + index * cardLayout.stride,
      y: 110 + (index % 2) * 28,
      width: cardLayout.cardWidth,
      height: Math.floor(cardLayout.cardWidth * 1.42),
      selected: index === 1,
      area: "market",
      compact: cardLayout.cardWidth < 120,
      index,
      onTap: () => {}
    });
  });
}

function renderActionsPanel(panel, scene, state, layout, gameState) {
  const { myTurn, activeType, safeSellCount, maxSell, minSell, handTypes } = gameState;

  createText(panel, `Turn: ${gameState.turnText}`, 18, 52, {
    fill: myTurn ? 0x8ce0bf : 0xe9d6b3,
    fontFamily: UI_FONT,
    fontSize: layout.compact ? 14 : 16,
    fontWeight: "700"
  });

  let y = 84;
  const fullWidth = layout.width - 36;
  const buttonHeight = layout.compact ? 44 : 50;
  const buttonSize = layout.compact ? 14 : 16;

  const actions = [
    { label: state.game?.mode === "singleplayer" ? "New Bot Match" : "Open Session", variant: "primary", onTap: state.onCreateGame, soundKind: "start" },
    { label: "Take Selected", variant: "accent", disabled: !myTurn || state.selected.market.length !== 1, onTap: () => state.onAction("takeOne", { cardId: state.selected.market[0] }) },
    { label: "Take Camels", variant: "accent", disabled: !myTurn, onTap: () => state.onAction("takeCamels") },
    {
      label: "Exchange",
      variant: "ghost",
      disabled: !myTurn,
      onTap: () => state.onAction("exchange", {
        marketIds: state.selected.market,
        handIds: state.selected.hand,
        herdIds: state.selected.herd
      })
    },
    {
      label: "Surrender",
      variant: "danger",
      disabled: !["waiting", "playing"].includes(state.game?.status),
      onTap: () => state.onAction("surrender")
    }
  ];

  actions.forEach((entry) => {
    createButton(panel, scene, {
      x: 18,
      y,
      width: fullWidth,
      height: buttonHeight,
      size: buttonSize,
      ...entry
    });
    y += buttonHeight + 10;
  });

  createText(panel, "Sell goods", 18, y + 12, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: layout.compact ? 18 : 22,
    fontWeight: "700"
  });
  createText(panel, activeType ? GOODS[activeType].label : "No sellable cards", 18, y + 42, {
    fill: activeType ? GOODS[activeType].color : 0xb7aa97,
    fontFamily: UI_FONT,
    fontSize: layout.compact ? 15 : 17,
    fontWeight: "700"
  });
  y += 70;

  const trioWidth = Math.floor((fullWidth - 20) / 3);
  createButton(panel, scene, {
    x: 18,
    y,
    width: trioWidth,
    height: 42,
    label: "<",
    variant: "ghost",
    disabled: handTypes.length < 2,
    onTap: () => state.cycleSellType(-1, handTypes)
  });
  createButton(panel, scene, {
    x: 28 + trioWidth,
    y,
    width: trioWidth,
    height: 42,
    label: String(safeSellCount),
    variant: "primary",
    disabled: true
  });
  createButton(panel, scene, {
    x: 38 + trioWidth * 2,
    y,
    width: trioWidth,
    height: 42,
    label: ">",
    variant: "ghost",
    disabled: handTypes.length < 2,
    onTap: () => state.cycleSellType(1, handTypes)
  });
  y += 54;

  createButton(panel, scene, {
    x: 18,
    y,
    width: trioWidth,
    height: 42,
    label: "-",
    variant: "ghost",
    disabled: !activeType || safeSellCount <= minSell,
    onTap: () => state.setSellCount((count) => Math.max(minSell, count - 1))
  });
  createButton(panel, scene, {
    x: 28 + trioWidth,
    y,
    width: trioWidth,
    height: 42,
    label: String(safeSellCount),
    variant: "accent",
    disabled: true
  });
  createButton(panel, scene, {
    x: 38 + trioWidth * 2,
    y,
    width: trioWidth,
    height: 42,
    label: "+",
    variant: "ghost",
    disabled: !activeType || safeSellCount >= maxSell,
    onTap: () => state.setSellCount((count) => Math.min(maxSell, count + 1))
  });
  y += 56;

  createButton(panel, scene, {
    x: 18,
    y,
    width: fullWidth,
    height: buttonHeight,
    label: activeType ? `Sell ${GOODS[activeType].label}` : "Sell",
    variant: "primary",
    disabled: !myTurn || !activeType,
    soundKind: "sell",
    onTap: () => state.onAction("sell", { type: activeType, count: safeSellCount })
  });
}

function renderLedgerPanel(panel, width, game, me, opponent, compact) {
  const players = [me, opponent].filter(Boolean);
  players.forEach((player, index) => {
    const cardY = 54 + index * (compact ? 78 : 90);
    const panelCard = new Graphics()
      .roundRect(18, cardY, width - 36, compact ? 64 : 74, 18)
      .fill({ color: player.id === game.currentPlayerId ? 0x2d6761 : 0x312522, alpha: 0.72 })
      .stroke({ color: player.id === game.currentPlayerId ? 0x92e0d0 : 0xf1ddb5, width: 2, alpha: 0.28 });
    panel.addChild(panelCard);

    createText(panel, player.name, 32, cardY + 12, {
      fill: 0xf8ebd1,
      fontFamily: UI_FONT,
      fontSize: compact ? 15 : 17,
      fontWeight: "700"
    });
    createText(panel, `${player.gold} gold`, 32, cardY + 34, {
      fill: 0xf0c96d,
      fontFamily: DISPLAY_FONT,
      fontSize: compact ? 20 : 24,
      fontWeight: "700"
    });
    createText(panel, `${player.handCount} hand · ${player.herdCount} camels`, 32, cardY + (compact ? 52 : 58), {
      fill: 0xc9b89f,
      fontFamily: UI_FONT,
      fontSize: compact ? 11 : 12
    });
  });

  const baseY = 54 + players.length * (compact ? 78 : 90) + 12;
  createText(panel, "Goods Tokens", 18, baseY, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: compact ? 18 : 21,
    fontWeight: "700"
  });

  Object.entries(game.tokens).forEach(([type, stack], index) => {
    const rowY = baseY + 34 + index * (compact ? 40 : 46);
    const token = new Graphics().roundRect(18, rowY, width - 36, compact ? 30 : 34, 12).fill({ color: GOODS[type].color, alpha: stack.length ? 0.22 : 0.08 });
    panel.addChild(token);
    createText(panel, GOODS[type].label, 28, rowY + 8, {
      fill: 0xf8ebd1,
      fontFamily: UI_FONT,
      fontSize: compact ? 11 : 12,
      fontWeight: "700"
    });
    createText(panel, `${stack[0] || 0} top`, compact ? 126 : 134, rowY + 8, {
      fill: 0xf0c96d,
      fontFamily: UI_FONT,
      fontSize: compact ? 10 : 11,
      fontWeight: "700"
    });
    createText(panel, `${stack.length} left`, compact ? 176 : 190, rowY + 8, {
      fill: 0xc9b89f,
      fontFamily: UI_FONT,
      fontSize: compact ? 10 : 11
    });
  });

  const logY = baseY + 34 + Object.keys(game.tokens).length * (compact ? 40 : 46) + 14;
  createText(panel, "Recent Moves", 18, logY, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: compact ? 18 : 21,
    fontWeight: "700"
  });
  game.log.slice(0, compact ? 5 : 7).forEach((line, index) => {
    createText(panel, `• ${line}`, 20, logY + 30 + index * (compact ? 20 : 24), {
      fill: 0xd7c4a4,
      fontFamily: UI_FONT,
      fontSize: compact ? 10 : 11,
      wordWrap: true,
      wordWrapWidth: compact ? 196 : 214
    });
  });
}

function renderBoardPanel(panel, scene, state, gameState, boardLayout) {
  const marketLayout = layoutCardStrip(gameState.marketCount, boardLayout.width - 36, boardLayout.marketIdeal, boardLayout.marketMin, 0.74);
  const handLayout = layoutCardStrip(gameState.handCount, boardLayout.width - 36, boardLayout.handIdeal, boardLayout.handMin, 0.56);
  const herdLayout = layoutCardStrip(Math.min(gameState.herdCount, boardLayout.herdVisible), boardLayout.width - 36, boardLayout.herdIdeal, boardLayout.herdMin, 0.5);

  createText(panel, "Market", 18, 52, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: boardLayout.compact ? 19 : 22,
    fontWeight: "700"
  });

  gameState.market.forEach((card, index) => {
    createCard(panel, scene, {
      card,
      x: 18 + index * marketLayout.stride,
      y: 82,
      width: marketLayout.cardWidth,
      height: Math.floor(marketLayout.cardWidth * 1.42),
      selected: gameState.marketSelected.has(card.id),
      area: "market",
      compact: marketLayout.cardWidth < 108,
      index,
      onTap: () => state.toggleSelection("market", card.id)
    });
  });

  const handY = 82 + Math.floor(marketLayout.cardWidth * 1.42) + boardLayout.sectionGap;
  createText(panel, "Your Hand", 18, handY, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: boardLayout.compact ? 19 : 22,
    fontWeight: "700"
  });
  gameState.hand.forEach((card, index) => {
    createCard(panel, scene, {
      card,
      x: 18 + index * handLayout.stride,
      y: handY + 30,
      width: handLayout.cardWidth,
      height: Math.floor(handLayout.cardWidth * 1.42),
      selected: gameState.handSelected.has(card.id),
      area: "hand",
      compact: handLayout.cardWidth < 106,
      index: 10 + index,
      onTap: () => state.toggleSelection("hand", card.id)
    });
  });

  const herdY = handY + 30 + Math.floor(handLayout.cardWidth * 1.42) + boardLayout.sectionGap;
  createText(panel, `Camel Herd · ${gameState.herdCount}`, 18, herdY, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: boardLayout.compact ? 19 : 22,
    fontWeight: "700"
  });
  gameState.herd.slice(0, boardLayout.herdVisible).forEach((card, index) => {
    createCard(panel, scene, {
      card,
      x: 18 + index * herdLayout.stride,
      y: herdY + 28,
      width: herdLayout.cardWidth,
      height: Math.floor(herdLayout.cardWidth * 1.28),
      selected: gameState.herdSelected.has(card.id),
      area: "herd",
      compact: true,
      index: 20 + index,
      onTap: () => state.toggleSelection("herd", card.id)
    });
  });
}

function renderGameScene(scene, state, metrics) {
  const game = state.game;
  const me = game.players.find((player) => player.id === state.me.id) || game.players[0];
  const opponent = game.players.find((player) => player.id !== state.me.id);
  const myTurn = game.status === "playing" && game.currentPlayerId === state.me.id;
  const handTypes = [...new Set((me.hand || []).map((card) => card.type))];
  const activeType = handTypes.includes(state.sellType) ? state.sellType : handTypes[0] || "";
  const maxSell = activeType ? (me.hand || []).filter((card) => card.type === activeType).length : 0;
  const minSell = activeType && ["diamonds", "gold", "silver"].includes(activeType) ? 2 : 1;
  const safeSellCount = clamp(state.sellCount, minSell, Math.max(minSell, maxSell || minSell));

  const turnText = game.status === "waiting"
    ? "Waiting for another trader"
    : game.status === "finished"
      ? getResultText(game, state.me)
      : myTurn
        ? "Your move"
        : opponent?.name || "Opponent";

  const rivalLabel = opponent?.isBot
    ? `${opponent.name} · ${opponent.difficulty || game.difficulty || "medium"} bot`
    : opponent?.name || "Opponent";

  const subtitle = game.status === "finished"
    ? getResultText(game, state.me)
    : game.status === "waiting"
      ? "Invite a second trader to open the market."
      : myTurn
        ? "Select cards directly on the table. The action rail updates for the current selection."
        : `Waiting for ${rivalLabel} to play.`;

  buildBackground(scene.root, scene, metrics.width, metrics.height, metrics.compact);
  renderHeader(scene.root, scene, state, metrics, "JAIPUR", subtitle, [
    { label: "Deck", value: String(game.deckCount) },
    { label: "Game", value: game.id },
    { label: "Turn", value: game.status === "playing" ? (myTurn ? "You" : rivalLabel) : game.status }
  ]);

  const bodyY = metrics.pad * 2 + metrics.headerHeight;
  const bodyHeight = metrics.height - bodyY - metrics.pad;
  const compactPanel = metrics.compact || metrics.phone;

  const renderState = {
    game,
    me,
    opponent,
    myTurn,
    turnText,
    activeType,
    safeSellCount,
    maxSell,
    minSell,
    handTypes,
    market: game.market,
    hand: me.hand || [],
    herd: me.herd || [],
    marketCount: game.market.length,
    handCount: (me.hand || []).length,
    herdCount: me.herdCount,
    marketSelected: new Set(state.selected.market),
    handSelected: new Set(state.selected.hand),
    herdSelected: new Set(state.selected.herd)
  };

  if (metrics.portrait) {
    const boardHeight = clamp(bodyHeight * 0.47, 304, 430);
    const lowerHeight = bodyHeight - boardHeight - metrics.pad;
    const actionsHeight = clamp(lowerHeight * 0.54, 250, 320);
    const ledgerHeight = lowerHeight - actionsHeight - metrics.pad;

    const board = createPanel(scene.root, metrics.pad, bodyY, metrics.width - metrics.pad * 2, boardHeight, "Trading Table", compactPanel);
    renderBoardPanel(board, scene, state, renderState, {
      width: metrics.width - metrics.pad * 2,
      compact: true,
      sectionGap: 24,
      marketIdeal: 92,
      marketMin: 56,
      handIdeal: 88,
      handMin: 52,
      herdIdeal: 52,
      herdMin: 36,
      herdVisible: 6
    });

    const actions = createPanel(scene.root, metrics.pad, bodyY + boardHeight + metrics.pad, metrics.width - metrics.pad * 2, actionsHeight, "Actions", true);
    renderActionsPanel(actions, scene, state, {
      width: metrics.width - metrics.pad * 2,
      compact: true
    }, renderState);

    const ledger = createPanel(scene.root, metrics.pad, bodyY + boardHeight + metrics.pad + actionsHeight + metrics.pad, metrics.width - metrics.pad * 2, ledgerHeight, "Ledger", true);
    renderLedgerPanel(ledger, metrics.width - metrics.pad * 2, game, me, opponent, true);
    return;
  }

  const leftWidth = metrics.wide ? 254 : 232;
  const rightWidth = metrics.wide ? 254 : 232;
  const boardX = metrics.pad * 2 + leftWidth;
  const boardWidth = metrics.width - boardX - rightWidth - metrics.pad * 2;

  const actions = createPanel(scene.root, metrics.pad, bodyY, leftWidth, bodyHeight, "Actions", compactPanel);
  renderActionsPanel(actions, scene, state, { width: leftWidth, compact: compactPanel }, renderState);

  const board = createPanel(scene.root, boardX, bodyY, boardWidth, bodyHeight, "Trading Table", compactPanel);
  renderBoardPanel(board, scene, state, renderState, {
    width: boardWidth,
    compact: compactPanel,
    sectionGap: compactPanel ? 28 : 34,
    marketIdeal: metrics.wide ? 146 : 122,
    marketMin: 82,
    handIdeal: metrics.wide ? 132 : 110,
    handMin: 74,
    herdIdeal: 70,
    herdMin: 44,
    herdVisible: 7
  });

  const ledger = createPanel(scene.root, metrics.width - metrics.pad - rightWidth, bodyY, rightWidth, bodyHeight, "Ledger", compactPanel);
  renderLedgerPanel(ledger, rightWidth, game, me, opponent, compactPanel);
}

function renderSettingsModal(scene, state, metrics) {
  const overlay = new Container();
  scene.root.addChild(overlay);

  overlay.addChild(new Graphics().rect(0, 0, metrics.width, metrics.height).fill({ color: 0x0b0606, alpha: 0.56 }));
  const panelWidth = Math.min(metrics.width - metrics.pad * 2, metrics.phone ? 360 : 620);
  const panelHeight = Math.min(metrics.height - metrics.pad * 2, metrics.phone ? 600 : 640);
  const panelX = (metrics.width - panelWidth) / 2;
  const panelY = (metrics.height - panelHeight) / 2;
  const panel = createPanel(overlay, panelX, panelY, panelWidth, panelHeight, "Settings", metrics.compact);

  createText(panel, "Audio now runs through Pixi's sound library with bundled CC0 assets. Preferences are stored locally in this browser.", 20, 50, {
    fill: 0xc9b89f,
    fontFamily: UI_FONT,
    fontSize: metrics.phone ? 12 : 13,
    wordWrap: true,
    wordWrapWidth: panelWidth - 40
  });

  const rowWidth = panelWidth - 40;
  const tripleGap = 10;
  const smallButton = Math.floor((rowWidth - tripleGap * 2) / 3);

  let y = 100;
  const rows = [
    {
      title: `Music: ${state.settings.musicEnabled ? "On" : "Off"} · ${Math.round(state.settings.musicVolume * 100)}%`,
      buttons: [
        { label: state.settings.musicEnabled ? "Disable" : "Enable", variant: state.settings.musicEnabled ? "danger" : "accent", onTap: () => state.patchSettings({ musicEnabled: !state.settings.musicEnabled }) },
        { label: "Vol -", variant: "ghost", onTap: () => state.patchSettings({ musicVolume: clamp(state.settings.musicVolume - 0.1, 0, 1) }) },
        { label: "Vol +", variant: "ghost", onTap: () => state.patchSettings({ musicVolume: clamp(state.settings.musicVolume + 0.1, 0, 1) }) }
      ]
    },
    {
      title: `SFX: ${state.settings.sfxEnabled ? "On" : "Off"} · ${Math.round(state.settings.sfxVolume * 100)}%`,
      buttons: [
        { label: state.settings.sfxEnabled ? "Disable" : "Enable", variant: state.settings.sfxEnabled ? "danger" : "accent", onTap: () => state.patchSettings({ sfxEnabled: !state.settings.sfxEnabled }) },
        { label: "Vol -", variant: "ghost", onTap: () => state.patchSettings({ sfxVolume: clamp(state.settings.sfxVolume - 0.1, 0, 1) }) },
        { label: "Vol +", variant: "ghost", onTap: () => state.patchSettings({ sfxVolume: clamp(state.settings.sfxVolume + 0.1, 0, 1) }) }
      ]
    }
  ];

  rows.forEach((row) => {
    createText(panel, row.title, 20, y, {
      fill: 0xf1ddb5,
      fontFamily: DISPLAY_FONT,
      fontSize: metrics.phone ? 18 : 20,
      fontWeight: "700"
    });
    row.buttons.forEach((button, index) => {
      createButton(panel, scene, {
        x: 20 + index * (smallButton + tripleGap),
        y: y + 28,
        width: smallButton,
        height: 44,
        size: metrics.phone ? 12 : 13,
        ...button
      });
    });
    y += 92;
  });

  createText(panel, `Music Track: ${AUDIO_TRACKS[state.settings.musicTrack]?.label || AUDIO_TRACKS.desert.label}`, 20, y, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: metrics.phone ? 18 : 20,
    fontWeight: "700"
  });
  createButton(panel, scene, {
    x: 20,
    y: y + 28,
    width: Math.floor((rowWidth - 10) / 2),
    height: 46,
    label: "Desert Travel",
    variant: state.settings.musicTrack === "desert" ? "accent" : "ghost",
    onTap: () => state.patchSettings({ musicTrack: "desert" })
  });
  createButton(panel, scene, {
    x: 30 + Math.floor((rowWidth - 10) / 2),
    y: y + 28,
    width: Math.floor((rowWidth - 10) / 2),
    height: 46,
    label: "Market Day",
    variant: state.settings.musicTrack === "market" ? "accent" : "ghost",
    onTap: () => state.patchSettings({ musicTrack: "market" })
  });
  y += 92;

  createText(panel, `Reduced Motion: ${state.settings.reducedMotion ? "On" : "Off"}`, 20, y, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: metrics.phone ? 18 : 20,
    fontWeight: "700"
  });
  createButton(panel, scene, {
    x: 20,
    y: y + 28,
    width: Math.floor((rowWidth - 10) / 2),
    height: 46,
    label: state.settings.reducedMotion ? "Full Motion" : "Reduce Motion",
    variant: state.settings.reducedMotion ? "ghost" : "accent",
    onTap: () => state.patchSettings({ reducedMotion: !state.settings.reducedMotion })
  });
  createButton(panel, scene, {
    x: 30 + Math.floor((rowWidth - 10) / 2),
    y: y + 28,
    width: Math.floor((rowWidth - 10) / 2),
    height: 46,
    label: state.isFullscreen ? "Exit Fullscreen" : "Fullscreen",
    variant: "ghost",
    onTap: state.onToggleFullscreen
  });
  y += 94;

  createText(panel, "Audio Credits", 20, y, {
    fill: 0xf1ddb5,
    fontFamily: DISPLAY_FONT,
    fontSize: metrics.phone ? 18 : 20,
    fontWeight: "700"
  });
  AUDIO_CREDITS.forEach((line, index) => {
    createText(panel, `• ${line}`, 20, y + 30 + index * 22, {
      fill: 0xd7c4a4,
      fontFamily: UI_FONT,
      fontSize: metrics.phone ? 11 : 12,
      wordWrap: true,
      wordWrapWidth: panelWidth - 40
    });
  });

  createButton(panel, scene, {
    x: 20,
    y: panelHeight - 62,
    width: panelWidth - 40,
    height: 44,
    label: "Close Settings",
    variant: "primary",
    soundKind: "close",
    onTap: state.onCloseSettings
  });
}

function drawScene(scene, state) {
  scene.root.removeChildren();
  scene.updaters = [];
  scene.motionScale = state.settings.reducedMotion ? 0.18 : 1;
  scene.reduceMotion = state.settings.reducedMotion;

  const metrics = getViewportMetrics(scene.width, scene.height);
  if (!state.me) renderAuthScene(scene, state, metrics);
  else if (!state.game) renderLobbyScene(scene, state, metrics);
  else renderGameScene(scene, state, metrics);

  if (state.toast) {
    const toastWidth = Math.min(metrics.width - metrics.pad * 2, metrics.phone ? 320 : 420);
    const toast = createPanel(scene.root, (metrics.width - toastWidth) / 2, metrics.height - 90, toastWidth, 56, "", true);
    toast.alpha = 0.94;
    createText(toast, state.toast, toastWidth / 2, 28, {
      fill: 0xf9efda,
      fontFamily: UI_FONT,
      fontSize: metrics.phone ? 12 : 14,
      fontWeight: "700",
      align: "center",
      wordWrap: true,
      wordWrapWidth: toastWidth - 30
    }, 0.5, 0.5);
  }

  if (state.settingsOpen) renderSettingsModal(scene, state, metrics);
}

export default function Page() {
  const hostRef = useRef(null);
  const appRef = useRef(null);
  const redrawSceneRef = useRef(() => {});
  const sceneRef = useRef({
    root: null,
    updaters: [],
    cardEntrances: new Map(),
    width: 0,
    height: 0,
    motionScale: 1,
    reduceMotion: false,
    onSound: () => {}
  });
  const audioRef = useRef(createAudioManager());
  const socketRef = useRef(null);
  const toastTimerRef = useRef(null);

  const [mode, setMode] = useState("login");
  const [authDraft, setAuthDraft] = useState({ name: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [toast, setToast] = useState("");
  const [persistence, setPersistence] = useState("memory");
  const [me, setMe] = useState(null);
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState({ market: [], hand: [], herd: [] });
  const [sellType, setSellType] = useState("");
  const [sellCount, setSellCount] = useState(1);
  const [matchSetup, setMatchSetup] = useState({ mode: "multiplayer", difficulty: "medium" });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const notify = async (message, kind = "tap") => {
    await audioRef.current.play(kind, settings);
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2200);
  };

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const data = await response.json();
    if (typeof data.persistence === "string") setPersistence(data.persistence);
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  const patchSettings = (nextValues) => {
    setSettings((current) => {
      const next = { ...current, ...nextValues };
      saveStoredSettings(next);
      return next;
    });
  };

  const onToggleFullscreen = async () => {
    await audioRef.current.prime();
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  };

  const onOpenSettings = async () => {
    await audioRef.current.play("start", settings);
    setSettingsOpen(true);
  };

  const onCloseSettings = async () => {
    await audioRef.current.play("close", settings);
    setSettingsOpen(false);
  };

  const onAuthSubmit = async () => {
    setAuthError("");
    await audioRef.current.prime();
    try {
      const data = await api(`/api/${mode}`, {
        method: "POST",
        body: JSON.stringify(authDraft)
      });
      setMe(data.user);
      await notify(mode === "login" ? "Welcome back." : "Trader account created.", "start");
    } catch (error) {
      setAuthError(error.message);
      await notify(error.message, "bad");
    }
  };

  const onCreateGame = async () => {
    await audioRef.current.prime();
    try {
      const data = await api("/api/games", {
        method: "POST",
        body: JSON.stringify(matchSetup)
      });
      setGame(data.game);
      setSelected({ market: [], hand: [], herd: [] });
      socketRef.current?.emit("game:join", { id: data.game.id }, () => {});
      await notify(matchSetup.mode === "singleplayer" ? `Bot match opened on ${matchSetup.difficulty}.` : "Session opened. Share the invite link.", "start");
    } catch (error) {
      await notify(error.message, "bad");
    }
  };

  const onCopyInvite = async () => {
    if (!game) {
      await notify("Open a session first.", "bad");
      return;
    }
    if (game.mode === "singleplayer") {
      await notify("Single-player bot matches do not use invite links.", "bad");
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}/join/${game.id}`);
    await notify("Invite copied.", "good");
  };

  const onLogout = async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    socketRef.current?.close();
    socketRef.current = null;
    setMe(null);
    setGame(null);
    setSelected({ market: [], hand: [], herd: [] });
    await notify("Signed out.", "tap");
  };

  const onAction = (action, payload = {}) => {
    if (!game || !socketRef.current) {
      notify("Open or join a session first.", "bad");
      return;
    }

    socketRef.current.emit("game:action", { id: game.id, action, payload }, async (reply) => {
      if (!reply?.ok) {
        await notify(reply?.error || "Move rejected.", "bad");
        return;
      }
      setSelected({ market: [], hand: [], herd: [] });
      const message = action === "sell"
        ? "Sale recorded."
        : action === "surrender"
          ? "You surrendered the match."
          : "Move played.";
      await notify(message, action === "sell" ? "sell" : "good");
    });
  };

  const toggleSelection = (area, id) => {
    setSelected((current) => ({
      ...current,
      [area]: toggleSelectionSet(current[area], id)
    }));
  };

  const cycleSellType = (direction, handTypes) => {
    if (handTypes.length < 2) return;
    const currentIndex = Math.max(handTypes.indexOf(sellType), 0);
    const nextIndex = (currentIndex + direction + handTypes.length) % handTypes.length;
    setSellType(handTypes[nextIndex]);
  };

  redrawSceneRef.current = () => {
    if (!appRef.current || !sceneRef.current.root) return;

    sceneRef.current.width = appRef.current.screen.width;
    sceneRef.current.height = appRef.current.screen.height;
    sceneRef.current.onSound = (kind) => {
      audioRef.current.play(kind, settings);
      audioRef.current.syncMusic(settings);
    };

    const inviteUrl = game ? `${window.location.origin}/join/${game.id}` : "";
    const joinHint = game?.mode === "singleplayer"
      ? `Bot difficulty: ${game.difficulty || "medium"}. No invite flow is needed for solo matches.`
      : window.location.pathname.startsWith("/join/")
      ? `This page is waiting on invite ${window.location.pathname.split("/").pop()}. Login to auto-join.`
      : "Host from here, then hand the invite link to your rival.";

    drawScene(sceneRef.current, {
      mode,
      setMode,
      authDraft,
      setAuthDraft,
      authError,
      toast,
      persistence,
      me,
      game,
      selected,
      sellType,
      sellCount,
      matchSetup,
      setMatchSetup,
      settings,
      settingsOpen,
      isFullscreen,
      inviteUrl,
      joinHint,
      onAuthSubmit,
      onCreateGame,
      onCopyInvite,
      onLogout,
      onAction,
      toggleSelection,
      cycleSellType,
      setSellCount,
      onOpenSettings,
      onCloseSettings,
      onToggleFullscreen,
      patchSettings
    });
  };

  useEffect(() => {
    setSettings(loadStoredSettings());
    setIsFullscreen(Boolean(document.fullscreenElement));
  }, []);

  useEffect(() => {
    saveStoredSettings(settings);
    audioRef.current.syncMusic(settings);
    redrawSceneRef.current();
  }, [settings]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      await audioRef.current.load();

      const app = new Application();
      await app.init({
        resizeTo: hostRef.current,
        antialias: true,
        backgroundAlpha: 0
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }

      hostRef.current.appendChild(app.canvas);
      const root = new Container();
      app.stage.addChild(root);
      sceneRef.current = {
        root,
        updaters: [],
        cardEntrances: sceneRef.current.cardEntrances,
        width: app.screen.width,
        height: app.screen.height,
        motionScale: 1,
        reduceMotion: false,
        onSound: (kind) => {
          audioRef.current.play(kind, settings);
          audioRef.current.syncMusic(settings);
        }
      };

      app.ticker.add(() => {
        const time = performance.now();
        sceneRef.current.updaters.forEach((update) => update(time));
      });

      appRef.current = app;

      const resize = () => redrawSceneRef.current();
      const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
      window.addEventListener("resize", resize);
      document.addEventListener("fullscreenchange", onFullscreenChange);

      redrawSceneRef.current();

      sceneRef.current.cleanup = () => {
        window.removeEventListener("resize", resize);
        document.removeEventListener("fullscreenchange", onFullscreenChange);
      };
    };

    boot();
    return () => {
      cancelled = true;
      window.clearTimeout(toastTimerRef.current);
      socketRef.current?.close();
      sceneRef.current.cleanup?.();
      audioRef.current.destroy();
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    api("/api/me").then((data) => {
      if (data.user) setMe(data.user);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!me || socketRef.current) return;
    const socket = io();
    socketRef.current = socket;

    socket.on("connect_error", () => notify("Login is required before joining a session.", "bad"));
    socket.on("game:state", (nextGame) => {
      setGame(nextGame);
      setSelected({ market: [], hand: [], herd: [] });
      notify("Table updated.", "good");
    });

    const joinId = window.location.pathname.match(/\/join\/([^/]+)/)?.[1];
    if (joinId) {
      socket.emit("game:join", { id: joinId }, async (reply) => {
        if (!reply?.ok) {
          await notify(reply?.error || "Could not join the session.", "bad");
          return;
        }
        setGame(reply.game);
        await notify("Joined the table.", "start");
      });
    }

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [me]);

  useEffect(() => {
    const handTypes = [...new Set((game?.players.find((player) => player.id === me?.id)?.hand || []).map((card) => card.type))];
    if (!handTypes.length) {
      setSellType("");
      setSellCount(1);
      return;
    }

    const nextType = handTypes.includes(sellType) ? sellType : handTypes[0];
    if (nextType !== sellType) setSellType(nextType);

    const matchingCards = (game?.players.find((player) => player.id === me?.id)?.hand || []).filter((card) => card.type === nextType).length;
    const nextMin = ["diamonds", "gold", "silver"].includes(nextType) ? 2 : 1;
    setSellCount((count) => clamp(count, nextMin, Math.max(nextMin, matchingCards || nextMin)));
  }, [game, me, sellType]);

  useEffect(() => {
    redrawSceneRef.current();
  }, [mode, authDraft, authError, toast, persistence, me, game, selected, sellType, sellCount, matchSetup, settingsOpen, isFullscreen]);

  return (
    <main className="shell">
      <div ref={hostRef} className="viewport" />
    </main>
  );
}
