import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { StyleProps } from 'react-native-reanimated';
import { GestureDetector, PanGesture } from 'react-native-gesture-handler';

interface ResizableBoundingBoxProps {
  animatedStyle: StyleProps;
  panBoxGesture: PanGesture;
  resizeTopLeftGesture: PanGesture;
  resizeTopRightGesture: PanGesture;
  resizeBottomLeftGesture: PanGesture;
  resizeBottomRightGesture: PanGesture;
}

const HANDLE_SIZE = 36;
const CORNER_THICKNESS = 4;
const CORNER_LENGTH = 20;

export const ResizableBoundingBox: React.FC<ResizableBoundingBoxProps> = ({
  animatedStyle,
  panBoxGesture,
  resizeTopLeftGesture,
  resizeTopRightGesture,
  resizeBottomLeftGesture,
  resizeBottomRightGesture,
}) => {
  return (
    <Animated.View style={[styles.boxContainer, animatedStyle]}>
      {/* Center Pan area for moving the bounding box */}
      <GestureDetector gesture={panBoxGesture}>
        <View style={styles.centerDragArea}>
          <View style={styles.aimCrosshair} />
        </View>
      </GestureDetector>

      {/* Frame border */}
      <View style={styles.boxBorder} pointerEvents="none" />

      {/* Top Left Corner */}
      <GestureDetector gesture={resizeTopLeftGesture}>
        <View style={[styles.handleTouchTarget, styles.topLeftHandle]}>
          <View style={[styles.cornerHorizontal, { top: 0, left: 0 }]} />
          <View style={[styles.cornerVertical, { top: 0, left: 0 }]} />
        </View>
      </GestureDetector>

      {/* Top Right Corner */}
      <GestureDetector gesture={resizeTopRightGesture}>
        <View style={[styles.handleTouchTarget, styles.topRightHandle]}>
          <View style={[styles.cornerHorizontal, { top: 0, right: 0 }]} />
          <View style={[styles.cornerVertical, { top: 0, right: 0 }]} />
        </View>
      </GestureDetector>

      {/* Bottom Left Corner */}
      <GestureDetector gesture={resizeBottomLeftGesture}>
        <View style={[styles.handleTouchTarget, styles.bottomLeftHandle]}>
          <View style={[styles.cornerHorizontal, { bottom: 0, left: 0 }]} />
          <View style={[styles.cornerVertical, { bottom: 0, left: 0 }]} />
        </View>
      </GestureDetector>

      {/* Bottom Right Corner */}
      <GestureDetector gesture={resizeBottomRightGesture}>
        <View style={[styles.handleTouchTarget, styles.bottomRightHandle]}>
          <View style={[styles.cornerHorizontal, { bottom: 0, right: 0 }]} />
          <View style={[styles.cornerVertical, { bottom: 0, right: 0 }]} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  boxContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 10,
  },
  boxBorder: {
    ...StyleSheet.absoluteFillObject,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderWidth: 1,
    borderRadius: 12,
  },
  centerDragArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  aimCrosshair: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 75, 75, 0.6)',
  },
  handleTouchTarget: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    zIndex: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topLeftHandle: {
    top: -HANDLE_SIZE / 4,
    left: -HANDLE_SIZE / 4,
  },
  topRightHandle: {
    top: -HANDLE_SIZE / 4,
    right: -HANDLE_SIZE / 4,
  },
  bottomLeftHandle: {
    bottom: -HANDLE_SIZE / 4,
    left: -HANDLE_SIZE / 4,
  },
  bottomRightHandle: {
    bottom: -HANDLE_SIZE / 4,
    right: -HANDLE_SIZE / 4,
  },
  cornerHorizontal: {
    position: 'absolute',
    width: CORNER_LENGTH,
    height: CORNER_THICKNESS,
    backgroundColor: '#FF3B30',
    borderRadius: 2,
  },
  cornerVertical: {
    position: 'absolute',
    width: CORNER_THICKNESS,
    height: CORNER_LENGTH,
    backgroundColor: '#FF3B30',
    borderRadius: 2,
  },
});
