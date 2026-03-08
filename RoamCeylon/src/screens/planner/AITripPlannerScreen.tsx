import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Animated,
  Modal
} from 'react-native';
import { useRef, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MainStackParamList } from '../../types';
import { aiService, TripPlanResponse, TripActivity } from '../../services/aiService';
import { usePlannerContext } from '../../context/PlannerContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import DaySelector from '../../components/DaySelector';
import ItineraryList from '../../components/ItineraryList';
import BudgetBreakdown from '../../components/BudgetBreakdown';
import EnhancedItineraryCard from '../../components/EnhancedItineraryCard';
import { PreferenceSummaryBanner } from '../../components/PreferenceSummaryBanner';
import { tripStorageService, TripFeedback } from '../../services/tripStorageService';
import { analyticsService } from '../../services/analyticsService';


import { MAPBOX_CONFIG } from '../../config/mapbox.config';

// Lazy load Mapbox to prevent build errors
let MapboxGL: any = null;

try {
  MapboxGL = require('@rnmapbox/maps').default;
  if (MAPBOX_CONFIG.accessToken) {
    MapboxGL.setAccessToken(MAPBOX_CONFIG.accessToken);
  }
} catch {
  // Mapbox SDK unavailable — map features disabled
}

import { TripPlannerForm } from './TripPlannerForm';

type AITripPlannerNavigationProp = StackNavigationProp<MainStackParamList, 'AITripPlanner'>;

const AITripPlannerScreen = () => {
  const navigation = useNavigation<AITripPlannerNavigationProp>();
  const { query, setQuery, tripPlan, setTripPlan, currentTripId, setCurrentTripId, isEditing, stopEditing } = usePlannerContext();
  const networkStatus = useNetworkStatus();

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedActivity, setSelectedActivity] = useState<TripActivity | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [tripName, setTripName] = useState('');
  const [useSavedContext, setUseSavedContext] = useState(true);
  const [showContextInfo, setShowContextInfo] = useState(false);

  // Feedback State
  const [feedbackState, setFeedbackState] = useState<'none' | 'positive' | 'negative'>('none');
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Ref for cleanup
  const isMounted = useRef(true);
  const contextInfoTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (contextInfoTimeout.current) {
        clearTimeout(contextInfoTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (tripPlan) {
      setSelectedDay(1); // Reset to Day 1 when new plan is loaded
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    } else {
      fadeAnim.setValue(0);
    }
  }, [tripPlan]);

  // Memoize budgets array to prevent recreation
  const budgets = useMemo(() => ['Low', 'Medium', 'High', 'Luxury'], []);

  // Memoize updateQuery to prevent recreation
  const updateQuery = useCallback((key: keyof typeof query, value: string | string[]) => {
    setQuery(prev => ({ ...prev, [key]: value }));
  }, [setQuery]);

  const handleGeneratePlan = useCallback(async () => {
    if (!query.destination || !query.duration) {
      Alert.alert('Missing Info', 'Please enter both destination and duration.');
      return;
    }

    // Check network connectivity
    if (!networkStatus.isConnected) {
      setError('No internet connection. Please check your network and try again.');
      return;
    }

    // Prevent double-clicks by checking if already loading
    if (isLoading) {
      return;
    }

    // Helper function to proceed with generation
    const proceedWithGeneration = async () => {
      setIsLoading(true);
      setError(null);
      setTripPlan(null);
      stopEditing(); // Clear editing state when generating a new plan

      // Reset feedback state so the new plan starts with a clean slate
      setFeedbackState('none');
      setIsFeedbackSubmitted(false);
      setSelectedReasons([]);

      try {
        // Include saved context parameters
        const requestWithContext = {
          ...query,
          useSavedContext: useSavedContext,
          mode: useSavedContext ? ('refine' as const) : ('new' as const),
        };
        const plan = await aiService.generateTripPlan(requestWithContext);

        if (isMounted.current) {
          setTripPlan(plan);

          // Store the backend-assigned tripId so feedback can be linked to this trip
          if (plan.tripId) {
            setCurrentTripId(plan.tripId);
          }

          // Show context info if used saved context
          if (plan.usedSavedContext) {
            setShowContextInfo(true);
            // Clear existing timeout if any
            if (contextInfoTimeout.current) clearTimeout(contextInfoTimeout.current);
            // Set new timeout
            contextInfoTimeout.current = setTimeout(() => {
              if (isMounted.current) setShowContextInfo(false);
            }, 5000);
          }

          // Log analytics event
          analyticsService.logPlanGenerated(
            plan.destination,
            plan.duration,
            plan.budget
          );
        }
      } catch (error) {
        if (isMounted.current) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          setError(`Failed to generate trip plan: ${errorMessage}`);
          console.error('[AITripPlannerScreen] Error generating plan:', error);
        }
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
        }
      }
    };

    // Warn if overwriting existing plan (not in editing mode)
    if (tripPlan && !isEditing) {
      Alert.alert(
        'Generate New Plan?',
        'This will replace your current trip plan. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Generate',
            onPress: proceedWithGeneration,
            style: 'destructive'
          }
        ]
      );
      return;
    }

    // Proceed directly if no existing plan or in editing mode
    await proceedWithGeneration();
  }, [query, networkStatus.isConnected, setTripPlan, tripPlan, isEditing, useSavedContext, stopEditing, isLoading]);

  const handleMoveActivity = useCallback((index: number, direction: 'up' | 'down') => {
    if (!tripPlan) return;

    // Optimized update without deep clone for everything
    setTripPlan(prevPlan => {
      if (!prevPlan) return null;

      const newItinerary = [...prevPlan.itinerary];
      const dayIndex = newItinerary.findIndex(d => d.day === selectedDay);

      if (dayIndex === -1) return prevPlan;

      const day = { ...newItinerary[dayIndex] };
      const newActivities = [...day.activities];

      if (direction === 'up' && index > 0) {
        [newActivities[index], newActivities[index - 1]] = [newActivities[index - 1], newActivities[index]];
      } else if (direction === 'down' && index < newActivities.length - 1) {
        [newActivities[index], newActivities[index + 1]] = [newActivities[index + 1], newActivities[index]];
      } else {
        return prevPlan; // No change
      }

      day.activities = newActivities;
      newItinerary[dayIndex] = day;

      return {
        ...prevPlan,
        itinerary: newItinerary
      };
    });
  }, [selectedDay, setTripPlan]);

  // ...

  // Handle deleting an activity
  const handleDeleteActivity = useCallback((index: number) => {
    if (!tripPlan) return;

    Alert.alert(
      "Remove Place?",
      "Are you sure you want to remove this place from your itinerary?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setTripPlan(prevPlan => {
              if (!prevPlan) return null;

              const newItinerary = [...prevPlan.itinerary];
              const dayIndex = newItinerary.findIndex(d => d.day === selectedDay);

              if (dayIndex === -1) return prevPlan;

              const day = { ...newItinerary[dayIndex] };
              const newActivities = [...day.activities];

              // Remove item
              const removed = newActivities.splice(index, 1)[0];

              if (selectedActivity && selectedActivity.description === removed.description) {
                setSelectedActivity(null);
              }

              day.activities = newActivities;

              if (newActivities.length === 0) {
                // Remove day if empty
                newItinerary.splice(dayIndex, 1);

                // Renumber
                newItinerary.forEach((d, idx) => {
                  d.day = idx + 1;
                  d.activities.forEach((act: any) => act.dayNumber = idx + 1);
                });

                // Update duration
                const newDuration = String(newItinerary.length);

                // Check if selectedDay is valid
                if (selectedDay > newItinerary.length) {
                  setSelectedDay(Math.max(1, newItinerary.length));
                }

                return {
                  ...prevPlan,
                  itinerary: newItinerary,
                  duration: newDuration
                };
              }

              newItinerary[dayIndex] = day;

              return {
                ...prevPlan,
                itinerary: newItinerary
              };
            });
          }
        }
      ]
    );
  }, [tripPlan, selectedDay, setTripPlan, selectedActivity]);

  const handleSaveTrip = useCallback(async () => {
    if (!tripPlan) return;

    if (!tripName.trim()) {
      Alert.alert('Trip Name Required', 'Please enter a name for your trip');
      return;
    }

    setIsSaving(true);

    // Close modal immediately for better UX
    const tripNameToSave = tripName.trim();
    setShowSaveDialog(false);
    setTripName('');

    try {
      if (isEditing && currentTripId) {
        // Update existing trip
        await tripStorageService.updateTrip(currentTripId, {
          name: tripNameToSave,
          tripPlan,
        });
        setIsSaving(false);
        Alert.alert('Success', 'Trip updated successfully!');
      } else {
        // Save new trip
        const savedTrip = await tripStorageService.saveTrip(tripNameToSave, tripPlan);
        analyticsService.logTripSaved(savedTrip.id, tripNameToSave);
        setIsSaving(false);
        Alert.alert('Success', 'Trip saved successfully!');
      }
    } catch (error) {
      setIsSaving(false);
      Alert.alert(
        'Error',
        isEditing ? 'Failed to update trip. Please try again.' : 'Failed to save trip. Please try again.'
      );
    }
  }, [tripPlan, tripName, isEditing, currentTripId]);

  // Load trip name and persisted feedback when entering editing mode
  useEffect(() => {
    const loadTripData = async () => {
      if (isEditing && currentTripId) {
        try {
          const trip = await tripStorageService.getTripById(currentTripId);
          if (trip) {
            setTripName(trip.name);
          }
        } catch (error) {
          console.error('Failed to load trip name:', error);
        }

        // Restore persisted feedback state so UI reflects prior submission
        try {
          const savedFeedback = await tripStorageService.getFeedbackForTrip(currentTripId);
          if (savedFeedback) {
            setFeedbackState(savedFeedback.isPositive ? 'positive' : 'negative');
            setIsFeedbackSubmitted(true);
            if (savedFeedback.reasons) {
              setSelectedReasons(savedFeedback.reasons);
            }
          } else {
            // No prior feedback for this trip — reset to clean state
            setFeedbackState('none');
            setIsFeedbackSubmitted(false);
            setSelectedReasons([]);
          }
        } catch (error) {
          console.error('Failed to load trip feedback:', error);
        }
      }
    };
    loadTripData();
  }, [isEditing, currentTripId]);

  const handleNavigateToSavedTrips = useCallback(() => {
    navigation.navigate('SavedTrips' as never);
  }, [navigation]);

  const handleFeedback = useCallback(async (isPositive: boolean) => {
    if (isFeedbackSubmitted) return;

    if (isPositive) {
      setFeedbackState('positive');
      setIsFeedbackSubmitted(true);

      // Save positive feedback properly
      const feedback: TripFeedback = {
        tripId: currentTripId || `temp_${Date.now()}`,
        isPositive: true,
        timestamp: new Date().toISOString(),
      };
      await tripStorageService.saveFeedback(feedback);

      analyticsService.logFeedbackSubmitted(true);
    } else {
      setFeedbackState('negative');
    }
  }, [currentTripId, isFeedbackSubmitted]);

  const handleSubmitNegativeFeedback = useCallback(async () => {
    setIsFeedbackSubmitted(true);

    // Save negative feedback properly
    const feedback: TripFeedback = {
      tripId: currentTripId || `temp_${Date.now()}`,
      isPositive: false,
      reasons: selectedReasons,
      timestamp: new Date().toISOString(),
    };
    await tripStorageService.saveFeedback(feedback);

    analyticsService.logFeedbackSubmitted(false, selectedReasons);
  }, [currentTripId, selectedReasons]);

  const toggleReason = useCallback((reason: string) => {
    setSelectedReasons(prev => {
      if (prev.includes(reason)) {
        return prev.filter(r => r !== reason);
      } else {
        return [...prev, reason];
      }
    });
  }, []);


  // Derived state for current day
  const currentDayItinerary = useMemo(() => {
    if (!tripPlan || !tripPlan.itinerary || !Array.isArray(tripPlan.itinerary)) {
      return null;
    }
    return tripPlan.itinerary.find(item => item && item.day === selectedDay) || null;
  }, [tripPlan, selectedDay]);

  const activities = useMemo(() => {
    if (!currentDayItinerary || !currentDayItinerary.activities || !Array.isArray(currentDayItinerary.activities)) {
      return [];
    }
    return currentDayItinerary.activities.filter(activity => activity != null);
  }, [currentDayItinerary]);

  // Derived state for map
  const mapActivities = useMemo(() => {
    return activities.filter(a => a.coordinate);
  }, [activities]);

  const routeCoordinates = useMemo(() => {
    return mapActivities.map(a => a.coordinate!);
  }, [mapActivities]);

  const routeFeature = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: routeCoordinates,
          },
        },
      ],
    };
  }, [routeCoordinates]);

  // Camera settings
  const cameraSettings = useMemo(() => {
    if (selectedActivity && selectedActivity.coordinate) {
      return {
        centerCoordinate: selectedActivity.coordinate,
        zoomLevel: 14,
        animationMode: 'flyTo',
        animationDuration: 1000,
      };
    } else if (routeCoordinates.length > 0) {
      if (routeCoordinates.length > 1) {
        return {
          bounds: {
            ne: [Math.max(...routeCoordinates.map(c => c[0])), Math.max(...routeCoordinates.map(c => c[1]))],
            sw: [Math.min(...routeCoordinates.map(c => c[0])), Math.min(...routeCoordinates.map(c => c[1]))],
            paddingBottom: 40,
            paddingTop: 40,
            paddingLeft: 40,
            paddingRight: 40,
          },
          animationMode: 'flyTo',
          animationDuration: 1500,
        };
      } else {
        return {
          centerCoordinate: routeCoordinates[0],
          zoomLevel: 11,
          animationMode: 'flyTo',
          animationDuration: 1500,
        };
      }
    }
    return {};
  }, [selectedActivity, routeCoordinates]);

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Trip Planner</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        {!tripPlan ? (
          <>
            {/* Saved Context Toggle */}
            <View style={styles.contextToggleCard}>
              <View style={styles.contextToggleHeader}>
                <Text style={styles.contextToggleIcon}>🔄</Text>
                <View style={styles.contextToggleTextContainer}>
                  <Text style={styles.contextToggleTitle}>Use Previous Trip Context</Text>
                  <Text style={styles.contextToggleSubtitle}>
                    {useSavedContext
                      ? 'Building on your last trip preferences'
                      : 'Starting fresh with a new trip'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.contextToggleButton, useSavedContext && styles.contextToggleButtonActive]}
                onPress={() => setUseSavedContext(!useSavedContext)}
                activeOpacity={0.7}
              >
                <Text style={[styles.contextToggleButtonText, useSavedContext && styles.contextToggleButtonTextActive]}>
                  {useSavedContext ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>
            </View>

            <TripPlannerForm
              query={query}
              updateQuery={updateQuery}
              isLoading={isLoading}
              onGenerate={handleGeneratePlan}
              isConnected={networkStatus.isConnected}
              budgets={budgets}
              error={error}
            />
          </>
        ) : tripPlan ? (
          <Animated.View style={[styles.resultsContainer, { opacity: fadeAnim }]}>
            {/* Context Info Banner */}
            {showContextInfo && tripPlan.usedSavedContext && (
              <View style={styles.contextInfoBanner}>
                <Text style={styles.contextInfoIcon}>✨</Text>
                <Text style={styles.contextInfoText}>
                  Refined from your previous trip preferences
                  {tripPlan.versionNo && ` (Version ${tripPlan.versionNo})`}
                </Text>
              </View>
            )}

            {/* Editing Mode Indicator */}
            {isEditing && (
              <View style={styles.editingBadge}>
                <Text style={styles.editingBadgeIcon}>✏️</Text>
                <Text style={styles.editingBadgeText}>Editing Mode</Text>
              </View>
            )}

            <Text style={styles.resultTitle}> Your Trip to {tripPlan.destination}</Text>
            <View style={styles.summaryContainer}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Duration</Text>
                <Text style={styles.summaryValue}>{tripPlan.duration} Days</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Budget</Text>
                <Text style={styles.summaryValue}>{tripPlan.budget}</Text>
              </View>
            </View>

            {/* Preference Summary Banner */}
            {query.interests && query.interests.length > 0 && (
              <PreferenceSummaryBanner
                selectedPreferences={query.interests}
                itinerary={tripPlan.itinerary}
              />
            )}

            {/* Feedback Section */}
            <View style={styles.feedbackSection}>
              <View style={styles.feedbackRow}>
                <Text style={styles.feedbackLabel}>How is this plan?</Text>
                <View style={styles.feedbackButtons}>
                  <TouchableOpacity
                    style={[
                      styles.feedbackButton,
                      feedbackState === 'positive' && styles.feedbackButtonSelected,
                      isFeedbackSubmitted && feedbackState !== 'positive' && styles.feedbackButtonDisabled
                    ]}
                    onPress={() => handleFeedback(true)}
                    disabled={isFeedbackSubmitted}
                  >
                    <Text style={styles.feedbackIcon}>👍</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.feedbackButton,
                      feedbackState === 'negative' && styles.feedbackButtonSelected,
                      isFeedbackSubmitted && feedbackState !== 'negative' && styles.feedbackButtonDisabled
                    ]}
                    onPress={() => handleFeedback(false)}
                    disabled={isFeedbackSubmitted}
                  >
                    <Text style={styles.feedbackIcon}>👎</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {feedbackState === 'negative' && !isFeedbackSubmitted && (
                <View style={styles.negativeFeedbackContainer}>
                  <Text style={styles.feedbackQuestion}>What can be improved?</Text>
                  <View style={styles.reasonChips}>
                    {['Too expensive', 'Too busy', 'Bad location', 'Not my style'].map((reason) => (
                      <TouchableOpacity
                        key={reason}
                        style={[
                          styles.reasonChip,
                          selectedReasons.includes(reason) && styles.reasonChipSelected
                        ]}
                        onPress={() => toggleReason(reason)}
                      >
                        <Text style={[
                          styles.reasonChipText,
                          selectedReasons.includes(reason) && styles.reasonChipTextSelected
                        ]}>{reason}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.feedbackActions}>
                    <TouchableOpacity
                      onPress={() => {
                        setFeedbackState('none');
                        setSelectedReasons([]);
                      }}
                      style={styles.feedbackCancelButton}
                    >
                      <Text style={styles.feedbackCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSubmitNegativeFeedback}
                      style={[
                        styles.feedbackSubmitButton,
                        selectedReasons.length === 0 && styles.feedbackSubmitButtonDisabled
                      ]}
                      disabled={selectedReasons.length === 0}
                    >
                      <Text style={styles.feedbackSubmitText}>Submit Feedback</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {isFeedbackSubmitted && (
                <View style={styles.thankYouContainer}>
                  <Text style={styles.thankYouText}>Thanks for your feedback! 🤖</Text>
                </View>
              )}
            </View>

            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, isEditing && styles.actionButtonPrimary]}
                onPress={() => setShowSaveDialog(true)}
              >
                <Text style={styles.actionButtonIcon}>{isEditing ? '💾' : '💾'}</Text>
                <Text style={[styles.actionButtonText, isEditing && styles.actionButtonTextPrimary]}>
                  {isEditing ? 'Update Trip' : 'Save Trip'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleNavigateToSavedTrips}
              >
                <Text style={styles.actionButtonIcon}>📂</Text>
                <Text style={styles.actionButtonText}>Saved Trips</Text>
              </TouchableOpacity>
            </View>

            {/* Budget Breakdown */}
            <BudgetBreakdown budget={tripPlan.budget} duration={tripPlan.duration} />

            {/* Day Selector */}
            <DaySelector
              days={tripPlan.itinerary.map(item => item.day)}
              selectedDay={selectedDay}
              onSelectDay={(day) => {
                setSelectedDay(day);
                setSelectedActivity(null); // Reset activity selection when changing day
              }}
            />

            {/* Map View */}
            {MapboxGL && mapActivities.length > 0 && (
              <View style={styles.mapContainer}>
                <MapboxGL.MapView
                  style={styles.map}
                  styleURL={MAPBOX_CONFIG.defaultStyle}
                  logoEnabled={false}
                  attributionEnabled={false}
                >
                  <MapboxGL.Camera
                    {...cameraSettings}
                  />

                  {/* Route Line */}
                  {routeCoordinates.length > 1 && (
                    <MapboxGL.ShapeSource id="routeSource" shape={routeFeature}>
                      <MapboxGL.LineLayer
                        id="routeFill"
                        style={{
                          lineColor: '#0066CC',
                          lineWidth: 3,
                          lineCap: 'round',
                          lineJoin: 'round',
                          lineOpacity: 0.8,
                          lineDasharray: [1, 1] // Dashed line for walking/travel path vibe
                        }}
                      />
                    </MapboxGL.ShapeSource>
                  )}

                  {/* Activity Markers */}
                  {mapActivities.map((activity, index) => {
                    const isSelected = selectedActivity === activity;
                    return (
                      <MapboxGL.PointAnnotation
                        key={`${selectedDay}-${index}`}
                        id={`marker-${index}`}
                        coordinate={activity.coordinate}
                        onSelected={() => setSelectedActivity(activity)}
                      >
                        <View style={styles.markerContainer}>
                          <View style={[styles.markerBadge, isSelected && styles.selectedMarkerBadge]}>
                            <Text style={styles.markerText}>{index + 1}</Text>
                          </View>
                        </View>
                      </MapboxGL.PointAnnotation>
                    );
                  })}
                </MapboxGL.MapView>
              </View>
            )}

            <View style={styles.dayCard}>
              <Text style={styles.dayTitle}>Day {selectedDay} Itinerary</Text>
              {activities.map((activity, index) => (
                <EnhancedItineraryCard
                  key={`${selectedDay}-${index}-${activity.description}`}
                  activity={activity}
                  index={index}
                  isSelected={selectedActivity === activity}
                  onPress={() => setSelectedActivity(activity)}
                  onMoveUp={() => handleMoveActivity(index, 'up')}
                  onMoveDown={() => handleMoveActivity(index, 'down')}
                  onDelete={() => handleDeleteActivity(index)}
                  canMoveUp={index > 0}
                  canMoveDown={index < activities.length - 1}
                />
              ))}
            </View>

            <View style={styles.bottomActions}>
              <TouchableOpacity
                style={styles.resetButton}
                onPress={() => {
                  setTripPlan(null);
                  stopEditing();
                  setUseSavedContext(true); // Keep context on by default
                }}
              >
                <Text style={styles.resetButtonText}>Refine This Trip</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.startFreshButton}
                onPress={() => {
                  setTripPlan(null);
                  stopEditing();
                  setUseSavedContext(false); // Start completely fresh
                }}
              >
                <Text style={styles.startFreshButtonText}>Start Fresh Trip</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        ) : null}
      </View>

      {/* Save Trip Dialog */}
      <Modal
        visible={showSaveDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSaveDialog(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{isEditing ? 'Update Trip' : 'Save Trip'}</Text>
            <Text style={styles.modalSubtitle}>
              {isEditing ? 'Update your trip name' : 'Give your trip a name'}
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g., Summer Sri Lanka Adventure"
              value={tripName}
              onChangeText={setTripName}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setShowSaveDialog(false);
                  setTripName('');
                }}
                disabled={isSaving}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave, isSaving && { opacity: 0.7 }]}
                onPress={handleSaveTrip}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalButtonTextSave}>
                    {isEditing ? 'Update' : 'Save'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    paddingTop: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  backButton: {
    fontSize: 16,
    color: '#0066CC',
    fontWeight: '600',
  },
  // Iterinary Results Styles
  resultsContainer: {
    width: '100%',
  },
  resultTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  summaryContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 25,
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0066CC',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  dayCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#0066CC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  dayTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  mapContainer: {
    height: 250,
    width: '100%',
    borderRadius: 15,
    overflow: 'hidden',
    marginBottom: 20,
    backgroundColor: '#e0e0e0', // Placeholder color
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerBadge: {
    backgroundColor: '#0066CC',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  selectedMarkerBadge: {
    backgroundColor: '#FF9800',
    transform: [{ scale: 1.2 }],
  },
  markerText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  activityRow: {
    flexDirection: 'row',
    marginBottom: 6,
    alignItems: 'flex-start',
  },
  bulletPoint: {
    fontSize: 16,
    color: '#0066CC',
    marginRight: 8,
    marginTop: -2,
  },
  activityText: {
    fontSize: 14,
    color: '#555',
    flex: 1,
    lineHeight: 20,
  },
  bottomActions: {
    marginTop: 20,
    gap: 10,
  },
  resetButton: {
    backgroundColor: '#0066CC',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  startFreshButton: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0066CC',
  },
  startFreshButtonText: {
    color: '#0066CC',
    fontWeight: '600',
    fontSize: 15,
  },
  // Context Toggle Styles
  contextToggleCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  contextToggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  contextToggleIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  contextToggleTextContainer: {
    flex: 1,
  },
  contextToggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  contextToggleSubtitle: {
    fontSize: 12,
    color: '#666',
  },
  contextToggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    minWidth: 50,
    alignItems: 'center',
  },
  contextToggleButtonActive: {
    backgroundColor: '#0066CC',
  },
  contextToggleButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  contextToggleButtonTextActive: {
    color: '#fff',
  },
  // Context Info Banner
  contextInfoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  contextInfoIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  contextInfoText: {
    fontSize: 13,
    color: '#2E7D32',
    fontWeight: '500',
    flex: 1,
  },
  // Action Buttons
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 10,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: '#0066CC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  actionButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0066CC',
  },
  actionButtonPrimary: {
    backgroundColor: '#0066CC',
  },
  actionButtonTextPrimary: {
    color: '#fff',
  },
  // Editing Mode Badge
  editingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3E0',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#FFB74D',
    alignSelf: 'center',
  },
  editingBadgeIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  editingBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F57C00',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 25,
    width: '85%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  modalButtonCancel: {
    backgroundColor: '#f0f0f0',
  },
  modalButtonSave: {
    backgroundColor: '#0066CC',
  },
  modalButtonTextCancel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  modalButtonTextSave: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  // Feedback Styles
  feedbackSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    marginTop: 5,
  },
  feedbackRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedbackLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: 15,
  },
  feedbackButton: {
    padding: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackButtonSelected: {
    backgroundColor: '#E3F2FD',
    borderWidth: 2,
    borderColor: '#2196F3',
  },
  feedbackButtonDisabled: {
    opacity: 0.6,
  },
  feedbackIcon: {
    fontSize: 20,
  },
  // Negative Feedback
  negativeFeedbackContainer: {
    width: '100%',
  },
  feedbackQuestion: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  reasonChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 15,
  },
  reasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#eee',
  },
  reasonChipSelected: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
  },
  reasonChipText: {
    fontSize: 12,
    color: '#666',
  },
  reasonChipTextSelected: {
    color: '#2196F3',
    fontWeight: '500',
  },
  feedbackActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 15,
    alignItems: 'center',
  },
  feedbackCancelButton: {
    padding: 8,
  },
  feedbackCancelText: {
    color: '#999',
    fontSize: 13,
  },
  feedbackSubmitButton: {
    backgroundColor: '#0066CC',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 15,
  },
  feedbackSubmitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  feedbackSubmitText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  // Thank You
  thankYouContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  thankYouText: {
    color: '#4CAF50',
    fontWeight: '600',
    fontSize: 14,
  },
});

export default React.memo(AITripPlannerScreen);
