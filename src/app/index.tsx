import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

type SavedPhoto = {
  id: string;
  uri: string;
};

const STORAGE_KEY = 'saved-photos-v1';
const APP_DOCUMENT_DIRECTORY = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? 'file://saved-photos/';
const isWeb = Platform.OS === 'web';

// Calculate modal and camera sizes based on the current window height so
// images and the gallery don't get clipped on small viewports (especially
// in browsers and small devices).
const WINDOW_HEIGHT = Dimensions.get('window').height;
const MODAL_MAX_HEIGHT = Math.max(200, WINDOW_HEIGHT - 24 * 4);
const MODAL_IMAGE_HEIGHT = Math.min(420, Math.floor(WINDOW_HEIGHT * 0.72));

// Camera preview height should be proportional to viewport on devices so the
// gallery below has enough room. Use a conservative fraction and clamp to a
// reasonable maximum.
const CAMERA_HEIGHT = Math.max(460, Math.max(280, Math.floor(WINDOW_HEIGHT * 0.42)));

type Point3D = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
};

function AnimatedBackground() {
  const { width, height } = useWindowDimensions();
  const [points, setPoints] = useState<Point3D[]>(() =>
    Array.from({ length: 12 }, (_, index) => ({
      x: (Math.random() - 0.5) * 2.2,
      y: (Math.random() - 0.5) * 2.2,
      z: (Math.random() - 0.5) * 2.2,
      vx: (Math.random() * 0.02 + 0.008) * (index % 2 === 0 ? 1 : -1),
      vy: (Math.random() * 0.02 + 0.008) * (index % 3 === 0 ? -1 : 1),
      vz: (Math.random() * 0.02 + 0.008) * (index % 2 === 0 ? -1 : 1),
      radius: 3 + (index % 4) * 1.5,
    }))
  );

  useEffect(() => {
    let animationFrame = 0;

    const tick = () => {
      setPoints((current) =>
        current.map((point) => {
          let { x, y, z, vx, vy, vz } = point;

          x += vx;
          y += vy;
          z += vz;

          if (x <= -1.8 || x >= 1.8) {
            x = Math.min(Math.max(x, -1.8), 1.8);
            vx *= -1;
          }

          if (y <= -1.8 || y >= 1.8) {
            y = Math.min(Math.max(y, -1.8), 1.8);
            vy *= -1;
          }

          if (z <= -1.8 || z >= 1.8) {
            z = Math.min(Math.max(z, -1.8), 1.8);
            vz *= -1;
          }

          return { ...point, x, y, z, vx, vy, vz };
        })
      );

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  const projectedPoints = points.map((point) => {
    const perspective = 4.2 - point.z;
    const scale = Math.max(80, Math.min(200, 120 / perspective));

    return {
      ...point,
      x: width / 2 + point.x * scale * 1.7,
      y: height / 2 + point.y * scale * 1.7,
      opacity: 0.5 + (point.z + 1.8) * 0.2,
    };
  });

  const segments = [] as Array<{ key: string; x1: number; y1: number; x2: number; y2: number; opacity: number }>;

  for (let i = 0; i < projectedPoints.length; i += 1) {
    for (let j = i + 1; j < projectedPoints.length; j += 1) {
      const a = projectedPoints[i];
      const b = projectedPoints[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const distance = Math.hypot(dx, dy);

      if (distance < 260) {
        segments.push({
          key: `${i}-${j}`,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          opacity: Math.max(0.15, 1 - distance / 260),
        });
      }
    }
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {segments.map((segment) => {
        const dx = segment.x2 - segment.x1;
        const dy = segment.y2 - segment.y1;
        const length = Math.hypot(dx, dy) || 1;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const midX = (segment.x1 + segment.x2) / 2;
        const midY = (segment.y1 + segment.y2) / 2;

        return (
          <View
            key={segment.key}
            style={{
              position: 'absolute',
              left: midX,
              top: midY,
              width: length,
              height: 1.5,
              transform: [
                { translateX: -length / 2 },
                { translateY: -0.75 },
                { rotate: `${angle}deg` },
              ],
              opacity: segment.opacity,
              backgroundColor: 'rgba(110, 231, 255, 0.9)',
              borderRadius: 1,
            }}
          />
        );
      })}

      {projectedPoints.map((point, index) => (
        <View
          key={`point-${index}`}
          style={{
            position: 'absolute',
            left: point.x - point.radius,
            top: point.y - point.radius,
            width: point.radius * 2,
            height: point.radius * 2,
            borderRadius: point.radius,
            backgroundColor: 'rgba(147, 197, 253, 0.95)',
            opacity: point.opacity,
            shadowColor: '#7dd3fc',
            shadowOpacity: 1,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [savedPhotos, setSavedPhotos] = useState<SavedPhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<SavedPhoto | null>(null);

  useEffect(() => {
    const loadSavedPhotos = async () => {
      try {
        const storedPhotos = await AsyncStorage.getItem(STORAGE_KEY);
        if (!storedPhotos) {
          return;
        }

        const parsedPhotos = JSON.parse(storedPhotos) as SavedPhoto[];
        if (!Array.isArray(parsedPhotos)) {
          return;
        }

        const validPhotos = parsedPhotos.filter(
          (photo) => typeof photo?.id === 'string' && typeof photo?.uri === 'string'
        );

        setSavedPhotos(validPhotos);
      } catch (error) {
        console.error('Failed to load saved photos', error);
      }
    };

    loadSavedPhotos();
  }, []);

  const persistPhotos = async (photos: SavedPhoto[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(photos));
    } catch (error) {
      console.error('Failed to save photos', error);
    }
  };

  const takePhoto = async () => {
    if (!cameraRef.current) {
      return;
    }

    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: isWeb });
      if (!result?.uri) {
        Alert.alert('No photo was captured');
        return;
      }

      const photoUri = isWeb ? result.uri : (() => {
        const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
        const finalUri = `${APP_DOCUMENT_DIRECTORY}${fileName}`;

        return finalUri;
      })();

      if (!isWeb) {
        await FileSystem.copyAsync({
          from: result.uri,
          to: photoUri,
        });
      }

      const nextPhoto: SavedPhoto = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        uri: photoUri,
      };

      setSavedPhotos((current) => {
        const updatedPhotos = [nextPhoto, ...current];
        void persistPhotos(updatedPhotos);
        return updatedPhotos;
      });
    } catch (error) {
      console.error('Failed to take picture', error);
      Alert.alert('Could not take a photo', 'Please try again.');
    }
  };

  const deletePhoto = async (photoId: string) => {
    const photoToDelete = savedPhotos.find((photo) => photo.id === photoId);

    const performDelete = () => {
      setSavedPhotos((current) => {
        const nextPhotos = current.filter((photo) => photo.id !== photoId);
        void persistPhotos(nextPhotos);
        return nextPhotos;
      });

      setSelectedPhoto((current) => (current?.id === photoId ? null : current));

      if (!isWeb && photoToDelete?.uri) {
        void FileSystem.deleteAsync(photoToDelete.uri, { idempotent: true }).catch((error) => {
          console.error('Failed to delete photo file', error);
        });
      }
    };

    if (Platform.OS === 'web') {
      const confirmed = window.confirm('Delete this photo from your gallery?');
      if (confirmed) {
        performDelete();
      }
      return;
    }

    Alert.alert('Delete photo', 'This photo will be removed from your gallery.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: performDelete,
      },
    ]);
  };

  if (!permission) {
    return <View style={styles.loading} />;
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.permissionContainer}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Camera access needed
          </ThemedText>
          <ThemedText type="small" style={styles.permissionText}>
            We need permission to access your camera so you can take a photo.
          </ThemedText>
          <Button title="Allow camera" onPress={requestPermission} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.backgroundLayer}>
        <AnimatedBackground />
      </View>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.cameraWrapper}>
          <CameraView ref={cameraRef} style={styles.camera} facing={facing} />
        </View>

        <View style={styles.controls}>
          <Button title="Flip" onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))} />
          <Button title="Take photo" onPress={takePhoto} />
        </View>

        <View style={styles.galleryHeader}>
          <ThemedText type="smallBold">Saved photos</ThemedText>
          {savedPhotos.length > 0 && (
            <ThemedText type="small" style={styles.galleryCount}>
              {savedPhotos.length}
            </ThemedText>
          )}
        </View>

        {savedPhotos.length > 0 ? (
          <FlatList
            style={styles.gallery}
            data={savedPhotos}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={styles.galleryList}
            columnWrapperStyle={styles.galleryRow}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.galleryCard}>
                <Pressable onPress={() => setSelectedPhoto(item)} style={styles.galleryPressable}>
                  <Image source={{ uri: item.uri }} style={styles.galleryImage} resizeMode="cover" />
                </Pressable>

                <Pressable
                  onPress={() => void deletePhoto(item.id)}
                  style={styles.deleteButton}
                  accessibilityRole="button"
                >
                  <ThemedText type="smallBold" style={styles.deleteButtonText}>
                    X
                  </ThemedText>
                </Pressable>
              </View>
            )}
          />
        ) : (
          <ThemedText type="small" style={styles.placeholderText}>
            No photos yet. Take a picture to save it to your gallery.
          </ThemedText>
        )}
      </SafeAreaView>

      <Modal transparent visible={selectedPhoto !== null} animationType="fade" onRequestClose={() => setSelectedPhoto(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedPhoto(null)}>
          <Pressable style={styles.modalContent} onPress={() => undefined}>
            {selectedPhoto ? (
              <>
                <Image source={{ uri: selectedPhoto.uri }} style={styles.modalImage} resizeMode="cover" />
                <View style={styles.modalActions}>
                  <Button title="Close" onPress={() => setSelectedPhoto(null)} />
                  <Button title="Delete" color="#d11a2a" onPress={() => void deletePhoto(selectedPhoto.id)} />
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#050b16',
  },
  safeArea: {
    flex: 1,
    position: 'relative',
    minHeight: 0,
    paddingHorizontal: Spacing.four,
    // paddingBottom: BottomTabInset + Spacing.three, #NOTE This was the issue with the gallery height
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    gap: Spacing.three,
    backgroundColor: 'rgba(5, 11, 22, 0.48)',
    zIndex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  permissionText: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  loading: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraWrapper: {
    width: '100%',
    // height: CAMERA_HEIGHT,
    flex: 1,
    minHeight: 0,
    // height: '50%',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.one,
  },
  galleryCount: {
    opacity: 0.8,
  },
  galleryList: {
    paddingBottom: Spacing.four,
    flexGrow: 1,
  },
  gallery: {
    flex: 1,
    minHeight: 0,
  },
  galleryRow: {
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  galleryCard: {
    width: '48%',
    aspectRatio: 1,
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#dfe3e8',
    borderWidth: 1,
    borderColor: '#dfe3e8',
  },
  galleryPressable: {
    flex: 1,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  deleteButton: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonText: {
    color: '#ffffff',
    fontSize: 22,
    lineHeight: 22,
  },
  placeholderText: {
    textAlign: 'center',
    opacity: 0.8,
    marginTop: Spacing.one,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
    padding: Spacing.two,
    gap: Spacing.two,
    maxHeight: MODAL_MAX_HEIGHT,
  },
  modalImage: {
    width: '100%',
    height: MODAL_IMAGE_HEIGHT,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  backgroundLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
    pointerEvents: 'none',
  },
});
