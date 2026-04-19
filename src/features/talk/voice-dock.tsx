import { useEffect, useMemo, useRef } from "react";
import { Animated, View } from "react-native";

import { palette } from "@/theme/palette";

type VoiceDockProps = {
  active: boolean;
  listening: boolean;
  processing?: boolean;
  success?: boolean;
  failed?: boolean;
  level?: number;
};

const BAR_COUNT = 6;
const PROCESSING_DOT_COUNT = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeMeter(level?: number) {
  if (typeof level !== "number" || Number.isNaN(level)) {
    return 0;
  }

  return clamp((level + 60) / 60, 0, 1);
}

export function VoiceDock({
  active: _active,
  listening,
  processing = false,
  success = false,
  failed = false,
  level
}: VoiceDockProps) {
  const normalizedLevel = useMemo(() => normalizeMeter(level), [level]);
  const processingPulse = useRef(new Animated.Value(1)).current;
  const bars = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.12))).current;
  const processingDots = useRef(Array.from({ length: PROCESSING_DOT_COUNT }, () => new Animated.Value(0))).current;
  const reactiveOrbScale = useMemo(() => 1 + normalizedLevel * 0.12, [normalizedLevel]);
  const listeningShape = useMemo(() => [0.48, 0.7, 0.96, 0.84, 0.62, 0.42], []);

  useEffect(() => {
    processingPulse.stopAnimation();
    bars.forEach((value) => value.stopAnimation());
    processingDots.forEach((value) => value.stopAnimation());

    if (success || failed) {
      processingPulse.setValue(1);
      bars.forEach((value, index) => value.setValue(index % 2 === 0 ? 0.16 : 0.12));
      processingDots.forEach((value) => value.setValue(0));
      return;
    }

    if (processing) {
      bars.forEach((value, index) => value.setValue(index % 2 === 0 ? 0.28 : 0.22));
      Animated.loop(
        Animated.sequence([
          Animated.timing(processingPulse, {
            toValue: 1.16,
            duration: 420,
            useNativeDriver: true
          }),
          Animated.timing(processingPulse, {
            toValue: 0.98,
            duration: 420,
            useNativeDriver: true
          })
        ])
      ).start();

      processingDots.forEach((value, index) => {
        Animated.loop(
          Animated.sequence([
            Animated.delay(index * 110),
            Animated.timing(value, {
              toValue: 1,
              duration: 220,
              useNativeDriver: true
            }),
            Animated.timing(value, {
              toValue: 0,
              duration: 220,
              useNativeDriver: true
            }),
            Animated.delay((PROCESSING_DOT_COUNT - index - 1) * 70)
          ])
        ).start();
      });
      return;
    }

    if (!listening) {
      processingPulse.setValue(1);
      bars.forEach((value, index) => value.setValue(index % 2 === 0 ? 0.14 : 0.1));
      processingDots.forEach((value) => value.setValue(0));
      return;
    }

    processingPulse.setValue(1);
    processingDots.forEach((value) => value.setValue(0));

    bars.forEach((value, index) => {
      Animated.spring(value, {
        toValue: clamp(0.16 + normalizedLevel * listeningShape[index], 0.16, 0.96),
        useNativeDriver: false,
        speed: 18,
        bounciness: 6
      }).start();
    });
  }, [bars, failed, listening, listeningShape, normalizedLevel, processing, processingDots, processingPulse, success]);

  const outerBackground = success
    ? "#2FA66B25"
    : failed
      ? "#C94B4B25"
      : processing
        ? "#F2B84B2A"
        : listening
          ? "#F2B84B30"
          : "#F3E7CF";
  const middleBackground = success
    ? "#2FA66B45"
    : failed
      ? "#C94B4B45"
      : processing
        ? "#F2B84B58"
        : listening
          ? "#F2B84B5A"
          : "#F7E6BC";
  const centerBackground = success
    ? "#2FA66B"
    : failed
      ? "#C94B4B"
      : palette.signal;
  const dotBackground = success || failed ? "#1E1A17" : "#1F1B17";
  const outerScale = success || failed ? 1 : processing ? processingPulse : 1 + normalizedLevel * 0.03;
  const middleScale = success || failed ? 1 : processing ? processingPulse.interpolate({ inputRange: [0.98, 1.16], outputRange: [0.99, 1.06] }) : 1 + normalizedLevel * 0.06;
  const centerScale = success || failed ? 1 : processing ? processingPulse.interpolate({ inputRange: [0.98, 1.16], outputRange: [0.99, 1.07] }) : reactiveOrbScale;

  return (
    <View style={{ alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
      <View style={{ alignItems: "center", justifyContent: "center", minHeight: 176, width: "100%" }}>
        <Animated.View
          style={{
            position: "absolute",
            width: 136,
            height: 136,
            borderRadius: 68,
            backgroundColor: outerBackground,
            transform: [{ scale: outerScale }]
          }}
        />
        <Animated.View
          style={{
            position: "absolute",
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: middleBackground,
            transform: [{ scale: middleScale }]
          }}
        />
        <Animated.View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: centerBackground,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ scale: centerScale }]
          }}
        >
          {success ? (
            <View style={{ width: 24, height: 18, transform: [{ rotate: "-8deg" }] }}>
              <View
                style={{
                  position: "absolute",
                  left: 4,
                  top: 8,
                  width: 8,
                  height: 4,
                  borderLeftWidth: 3,
                  borderBottomWidth: 3,
                  borderColor: "#1E1A17",
                  transform: [{ rotate: "-40deg" }]
                }}
              />
              <View
                style={{
                  position: "absolute",
                  left: 10,
                  top: 5,
                  width: 13,
                  height: 7,
                  borderLeftWidth: 3,
                  borderBottomWidth: 3,
                  borderColor: "#1E1A17",
                  transform: [{ rotate: "-45deg" }]
                }}
              />
            </View>
          ) : failed ? (
            <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
              <View
                style={{
                  position: "absolute",
                  width: 20,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: "#FFF3EE",
                  transform: [{ rotate: "45deg" }]
                }}
              />
              <View
                style={{
                  position: "absolute",
                  width: 20,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: "#FFF3EE",
                  transform: [{ rotate: "-45deg" }]
                }}
              />
            </View>
          ) : (
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: dotBackground
              }}
            />
          )}
        </Animated.View>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 8,
          height: 42
        }}
      >
        {bars.map((value, index) => (
          <Animated.View
            key={index}
            style={{
              width: 7,
              borderRadius: 99,
              backgroundColor: success
                ? "#2FA66B"
                : failed
                  ? "#C94B4B"
                  : processing
                    ? "#DCC8A0"
                    : listening
                      ? index === 2 || index === 3
                        ? palette.signal
                        : "#F4D388"
                      : "#D7CEC4",
              height: value.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 40]
              })
            }}
          />
        ))}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          height: 18
        }}
      >
        {processingDots.map((value, index) => (
          <Animated.View
            key={`processing-dot-${index}`}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: palette.signal,
              opacity: value.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1]
              }),
              transform: [
                {
                  translateY: value.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8]
                  })
                },
                {
                  scale: value.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.86, 1.12]
                  })
                }
              ]
            }}
          />
        ))}
      </View>
    </View>
  );
}
