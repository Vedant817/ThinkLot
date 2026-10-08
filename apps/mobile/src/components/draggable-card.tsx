import { useMemo, useState, type PropsWithChildren } from "react";
import { Animated, PanResponder, Text, View } from "react-native";
import { usePalette } from "./ui";

export function DraggableCard({
  children,
  disabled,
  onStart,
  onCancel,
  onDrop,
}: PropsWithChildren<{
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
  onDrop: (x: number, y: number) => void;
}>) {
  const c = usePalette();
  const [offset] = useState(() => new Animated.ValueXY());
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: onStart,
        onPanResponderMove: (_, gesture) =>
          offset.setValue({ x: gesture.dx, y: gesture.dy }),
        onPanResponderRelease: (_, gesture) => {
          offset.setValue({ x: 0, y: 0 });
          if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > 12)
            onDrop(gesture.moveX, gesture.moveY);
          else onCancel();
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => {
          offset.setValue({ x: 0, y: 0 });
          onCancel();
        },
      }),
    [disabled, offset, onStart, onCancel, onDrop],
  );
  return (
    <Animated.View
      style={{ transform: offset.getTranslateTransform(), gap: 10 }}
    >
      {children}
      <View
        {...responder.panHandlers}
        accessible={false}
        style={{
          minHeight: 48,
          justifyContent: "center",
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: c.line,
          paddingHorizontal: 12,
        }}
      >
        <Text style={{ color: c.muted }}>⠿ Drag to another stage</Text>
      </View>
    </Animated.View>
  );
}
