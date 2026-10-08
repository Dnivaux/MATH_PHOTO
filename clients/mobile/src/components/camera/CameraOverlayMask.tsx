import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

interface CameraOverlayMaskProps {
  screenWidth: number;
  screenHeight: number;
  boxX: SharedValue<number>;
  boxY: SharedValue<number>;
  boxWidth: SharedValue<number>;
  boxHeight: SharedValue<number>;
}

export const CameraOverlayMask: React.FC<CameraOverlayMaskProps> = ({
  screenWidth,
  screenHeight,
  boxX,
  boxY,
  boxWidth,
  boxHeight,
}) => {
  // Top mask
  const topStyle = useAnimatedStyle(() => ({
    top: 0,
    left: 0,
    width: screenWidth,
    height: boxY.value,
  }));

  // Bottom mask
  const bottomStyle = useAnimatedStyle(() => ({
    top: boxY.value + boxHeight.value,
    left: 0,
    width: screenWidth,
    height: Math.max(0, screenHeight - (boxY.value + boxHeight.value)),
  }));

  // Left mask
  const leftStyle = useAnimatedStyle(() => ({
    top: boxY.value,
    left: 0,
    width: boxX.value,
    height: boxHeight.value,
  }));

  // Right mask
  const rightStyle = useAnimatedStyle(() => ({
    top: boxY.value,
    left: boxX.value + boxWidth.value,
    width: Math.max(0, screenWidth - (boxX.value + boxWidth.value)),
    height: boxHeight.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.mask, topStyle]} />
      <Animated.View style={[styles.mask, bottomStyle]} />
      <Animated.View style={[styles.mask, leftStyle]} />
      <Animated.View style={[styles.mask, rightStyle]} />
    </View>
  );
};

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(10, 10, 15, 0.62)',
  },
});
