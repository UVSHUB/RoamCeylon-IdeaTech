import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MainStackParamList } from '../../types';
import { aiService, TripPlanRequest, TripActivity } from '../../services/aiService';

type AIPlannerTestingNavigationProp = StackNavigationProp<MainStackParamList, 'AIPlannerTesting'>;

interface ScoreBreakdown {
  baseScore: number;
  confidenceBonus: number;
  preferenceBonus: number;
  feedbackBonus: number;
  optimizationBonus?: number;
  totalScore: number;
}

interface RankingComparison {
  activity: TripActivity;
  baselineScore: number;
  optimizedScore: number;
  scoreDifference: number;
  percentChange: number;
  baselineBreakdown: ScoreBreakdown;
  optimizedBreakdown: ScoreBreakdown;
  baselineRank: number;
  optimizedRank: number;
  rankChange: number;
}

interface PerformanceMetrics {
  rankingComputationTime: number;
  renderCount: number;
  lastRenderTime: number;
}

interface TestResult {
  destination: string;
  timestamp: Date;
  rankingStrategy: 'optimized_v1';
  comparisons: RankingComparison[];
  averageImprovement: number;
  performanceMetrics: PerformanceMetrics;
}

const AIPlannerTestingScreen = () => {
  const navigation = useNavigation<AIPlannerTestingNavigationProp>();
  const [isLoading, setIsLoading] = useState(false);
  const [testResults, setTestResults] = useState<TestResult | null>(null);
  const [expandedScores, setExpandedScores] = useState<Set<number>>(new Set());

  // Performance tracking — useRef so incrementing never triggers a re-render
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  // Test configuration
  const [testDestination, setTestDestination] = useState('Kandy');
  const [testDuration, setTestDuration] = useState('3 days');
  const [testBudget] = useState('Medium');
  const [testInterests] = useState(['Culture', 'Nature', 'Adventure']);

  // Calculate ranking score with detailed breakdown
  const calculateRankingScoreWithBreakdown = (
    activity: TripActivity,
    useOptimized: boolean
  ): ScoreBreakdown => {
    const baseScore = 50;
    let confidenceBonus = 0;
    let preferenceBonus = 0;
    let feedbackBonus = 0;
    let optimizationBonus = 0;

    // Confidence score weighting
    if (activity.confidenceScore === 'High') confidenceBonus = 25;
    else if (activity.confidenceScore === 'Medium') confidenceBonus = 15;
    else if (activity.confidenceScore === 'Low') confidenceBonus = 5;

    // Preference matching
    const matchCount = activity.matchedPreferences?.length || 0;
    preferenceBonus = matchCount * 8;

    // Positive feedback bonus
    if (activity.hasPositiveFeedback) {
      feedbackBonus = 15;
    }

    // Optimization algorithm improvements
    if (useOptimized) {
      optimizationBonus += matchCount * 2; // Better preference weighting
      if (activity.hasPositiveFeedback) optimizationBonus += 5; // Enhanced feedback
      if (activity.confidenceScore === 'High') optimizationBonus += 8; // Confidence boost
      if (activity.confidenceScore === 'Low') optimizationBonus += 3; // Penalty reduction
    }

    const totalScore = Math.min(
      100,
      Math.max(0, baseScore + confidenceBonus + preferenceBonus + feedbackBonus + optimizationBonus)
    );

    return {
      baseScore,
      confidenceBonus,
      preferenceBonus,
      feedbackBonus,
      optimizationBonus: useOptimized ? optimizationBonus : undefined,
      totalScore,
    };
  };

  const runComparisonTest = useCallback(async () => {
    setIsLoading(true);
    const renderStartTime = performance.now();

    try {
      // Prepare request
      const request: TripPlanRequest = {
        destination: testDestination,
        duration: testDuration,
        budget: testBudget,
        interests: testInterests,
        useSavedContext: true,
        mode: 'new',
      };

      // Generate trip plan
      const planResponse = await aiService.generateTripPlan(request);

      // Extract all activities from the itinerary
      const allActivities: TripActivity[] = [];
      planResponse.itinerary.forEach(day => {
        allActivities.push(...day.activities);
      });

      if (allActivities.length === 0) {
        Alert.alert('No Activities', 'No activities were generated for comparison.');
        return;
      }

      // Start performance tracking for ranking computation
      const computationStartTime = performance.now();

      // Calculate scores with breakdowns for both baseline and optimized
      const comparisonsWithScores = allActivities.map(activity => {
        const baselineBreakdown = calculateRankingScoreWithBreakdown(activity, false);
        const optimizedBreakdown = calculateRankingScoreWithBreakdown(activity, true);
        const scoreDifference = optimizedBreakdown.totalScore - baselineBreakdown.totalScore;
        const percentChange = baselineBreakdown.totalScore > 0
          ? ((scoreDifference / baselineBreakdown.totalScore) * 100)
          : 0;

        return {
          activity,
          baselineScore: baselineBreakdown.totalScore,
          optimizedScore: optimizedBreakdown.totalScore,
          scoreDifference,
          percentChange,
          baselineBreakdown,
          optimizedBreakdown,
          baselineRank: 0, // Will be calculated below
          optimizedRank: 0, // Will be calculated below
          rankChange: 0,
        };
      });

      // Sort by baseline scores and assign ranks
      const baselineSorted = [...comparisonsWithScores].sort(
        (a, b) => b.baselineScore - a.baselineScore
      );
      baselineSorted.forEach((comp, index) => {
        comp.baselineRank = index + 1;
      });

      // Sort by optimized scores and assign ranks
      const optimizedSorted = [...comparisonsWithScores].sort(
        (a, b) => b.optimizedScore - a.optimizedScore
      );
      optimizedSorted.forEach((comp, index) => {
        comp.optimizedRank = index + 1;
        // Calculate rank change (negative = moved up, positive = moved down)
        comp.rankChange = comp.optimizedRank - comp.baselineRank;
      });

      const computationEndTime = performance.now();
      const computationTime = computationEndTime - computationStartTime;

      const comparisons: RankingComparison[] = comparisonsWithScores;

      // Calculate average improvement
      const avgImprovement = comparisons.reduce((sum, comp) =>
        sum + comp.scoreDifference, 0) / comparisons.length;

      const renderEndTime = performance.now();
      const renderTime = renderEndTime - renderStartTime;

      const results: TestResult = {
        destination: testDestination,
        timestamp: new Date(),
        rankingStrategy: 'optimized_v1',
        comparisons,
        averageImprovement: parseFloat(avgImprovement.toFixed(2)),
        performanceMetrics: {
          rankingComputationTime: parseFloat(computationTime.toFixed(2)),
          renderCount: renderCountRef.current,
          lastRenderTime: parseFloat(renderTime.toFixed(2)),
        },
      };

      setTestResults(results);

      Alert.alert(
        'Test Complete',
        `Average improvement: ${avgImprovement.toFixed(2)} points\n` +
        `Total activities tested: ${comparisons.length}\n` +
        `Computation time: ${computationTime.toFixed(2)}ms`
      );
    } catch (error) {
      console.error('Comparison test failed:', error);
      Alert.alert('Test Failed', 'Unable to run comparison test. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [testDestination, testDuration, testBudget, testInterests]);

  const toggleScoreExpansion = (index: number) => {
    setExpandedScores(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const renderScoreBreakdown = (breakdown: ScoreBreakdown, label: string) => (
    <View style={styles.breakdownContainer}>
      <Text style={styles.breakdownTitle}>{label} Breakdown:</Text>
      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownLabel}>Base Score</Text>
        <Text style={styles.breakdownValue}>{breakdown.baseScore}</Text>
      </View>
      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownLabel}>Confidence Bonus</Text>
        <Text style={styles.breakdownValue}>+{breakdown.confidenceBonus}</Text>
      </View>
      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownLabel}>Preference Bonus</Text>
        <Text style={styles.breakdownValue}>+{breakdown.preferenceBonus}</Text>
      </View>
      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownLabel}>Feedback Bonus</Text>
        <Text style={styles.breakdownValue}>+{breakdown.feedbackBonus}</Text>
      </View>
      {breakdown.optimizationBonus !== undefined && breakdown.optimizationBonus > 0 && (
        <View style={styles.breakdownRow}>
          <Text style={[styles.breakdownLabel, styles.optimizationText]}>Optimization Bonus</Text>
          <Text style={[styles.breakdownValue, styles.optimizationText]}>
            +{breakdown.optimizationBonus}
          </Text>
        </View>
      )}
      <View style={[styles.breakdownRow, styles.totalRow]}>
        <Text style={styles.breakdownTotalLabel}>Total Score</Text>
        <Text style={styles.breakdownTotalValue}>{breakdown.totalScore}</Text>
      </View>
    </View>
  );

  const renderRankBadge = (baselineRank: number, optimizedRank: number, rankChange: number) => {
    const rankImproved = rankChange < 0; // Negative change means moved up
    const rankWorsened = rankChange > 0;
    const rankUnchanged = rankChange === 0;

    return (
      <View style={styles.rankBadgeContainer}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankLabel}>Rank:</Text>
          <Text style={styles.rankValue}>#{baselineRank}</Text>
          <Ionicons
            name={rankImproved ? "arrow-up" : rankWorsened ? "arrow-down" : "remove"}
            size={16}
            color={rankImproved ? "#10B981" : rankWorsened ? "#EF4444" : "#6B7280"}
          />
          <Text style={[
            styles.rankValue,
            rankImproved ? styles.improvedRank : rankWorsened ? styles.worsenedRank : styles.neutralRank
          ]}>
            #{optimizedRank}
          </Text>
        </View>
        {rankChange !== 0 && (
          <Text style={[
            styles.rankChangeText,
            rankImproved ? styles.positiveChange : styles.negativeChange
          ]}>
            {rankImproved ? `↑ ${Math.abs(rankChange)}` : `↓ ${rankChange}`} position{Math.abs(rankChange) > 1 ? 's' : ''}
          </Text>
        )}
      </View>
    );
  };

  const renderComparisonCard = (comparison: RankingComparison, index: number) => {
    const isImproved = comparison.scoreDifference > 0;
    const isNeutral = comparison.scoreDifference === 0;
    const isExpanded = expandedScores.has(index);

    return (
      <View key={index} style={styles.comparisonCard}>
        <View style={styles.activityHeader}>
          <Text style={styles.activityTitle} numberOfLines={2}>
            {comparison.activity.description}
          </Text>
          <View style={styles.headerRow}>
            {comparison.activity.category && (
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryText}>{comparison.activity.category}</Text>
              </View>
            )}
            {renderRankBadge(comparison.baselineRank, comparison.optimizedRank, comparison.rankChange)}
          </View>
        </View>

        <View style={styles.scoreContainer}>
          <View style={styles.scoreColumn}>
            <Text style={styles.scoreLabel}>Baseline</Text>
            <Text style={styles.scoreValue}>{comparison.baselineScore.toFixed(1)}</Text>
          </View>

          <View style={styles.arrowContainer}>
            <Ionicons
              name={isImproved ? "arrow-forward" : isNeutral ? "remove" : "arrow-back"}
              size={24}
              color={isImproved ? "#10B981" : isNeutral ? "#6B7280" : "#EF4444"}
            />
          </View>

          <View style={styles.scoreColumn}>
            <Text style={styles.scoreLabel}>Optimized</Text>
            <Text style={[
              styles.scoreValue,
              isImproved ? styles.improvedScore : isNeutral ? styles.neutralScore : styles.decreasedScore
            ]}>
              {comparison.optimizedScore.toFixed(1)}
            </Text>
          </View>

          <View style={styles.differenceContainer}>
            <Text style={[
              styles.differenceText,
              isImproved ? styles.positiveChange : isNeutral ? styles.neutralChange : styles.negativeChange
            ]}>
              {comparison.scoreDifference > 0 ? '+' : ''}{comparison.scoreDifference.toFixed(1)}
            </Text>
            <Text style={styles.percentText}>
              ({comparison.percentChange > 0 ? '+' : ''}{comparison.percentChange.toFixed(1)}%)
            </Text>
          </View>
        </View>

        {/* Expand/Collapse Button for Score Breakdown */}
        <TouchableOpacity
          style={styles.expandButton}
          onPress={() => toggleScoreExpansion(index)}
        >
          <Text style={styles.expandButtonText}>
            {isExpanded ? 'Hide' : 'Show'} Score Breakdown
          </Text>
          <Ionicons
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color="#3B82F6"
          />
        </TouchableOpacity>

        {/* Score Breakdown Details */}
        {isExpanded && (
          <View style={styles.breakdownSection}>
            {renderScoreBreakdown(comparison.baselineBreakdown, 'Baseline')}
            {renderScoreBreakdown(comparison.optimizedBreakdown, 'Optimized')}
          </View>
        )}

        {/* Activity Metadata */}
        <View style={styles.metadataContainer}>
          {comparison.activity.confidenceScore && (
            <View style={styles.metadataItem}>
              <MaterialCommunityIcons name="chart-line" size={14} color="#6B7280" />
              <Text style={styles.metadataText}>{comparison.activity.confidenceScore}</Text>
            </View>
          )}
          {comparison.activity.hasPositiveFeedback && (
            <View style={styles.metadataItem}>
              <Ionicons name="thumbs-up" size={14} color="#10B981" />
              <Text style={styles.metadataText}>Positive Feedback</Text>
            </View>
          )}
          {comparison.activity.matchedPreferences && comparison.activity.matchedPreferences.length > 0 && (
            <View style={styles.metadataItem}>
              <Ionicons name="checkmark-circle" size={14} color="#3B82F6" />
              <Text style={styles.metadataText}>
                {comparison.activity.matchedPreferences.length} matches
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <LinearGradient
      colors={['#edfaea', '#d5f2ce', '#b6e9ab']}
      style={styles.container}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Planner Testing</Text>
        <View style={styles.internalBadge}>
          <Text style={styles.internalText}>INTERNAL</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Ranking Strategy Info Card */}
        <View style={styles.strategyCard}>
          <View style={styles.toggleHeader}>
            <MaterialCommunityIcons name="brain" size={24} color="#10B981" />
            <Text style={styles.toggleTitle}>Ranking Strategy</Text>
          </View>
          <View style={styles.strategyBadgeRow}>
            <View style={styles.strategyBadge}>
              <Text style={styles.strategyBadgeText}>optimized_v1</Text>
            </View>
            <Text style={styles.strategyDescription}>
              Enhanced algorithm — active on all results
            </Text>
          </View>
        </View>

        {/* Performance Monitoring Card */}
        {testResults && (
          <View style={styles.performanceCard}>
            <View style={styles.toggleHeader}>
              <MaterialCommunityIcons name="speedometer" size={24} color="#3B82F6" />
              <Text style={styles.toggleTitle}>Performance Metrics</Text>
            </View>
            <View style={styles.performanceGrid}>
              <View style={styles.performanceItem}>
                <Text style={styles.performanceLabel}>Computation Time</Text>
                <Text style={styles.performanceValue}>
                  {testResults.performanceMetrics.rankingComputationTime.toFixed(2)}ms
                </Text>
              </View>
              <View style={styles.performanceItem}>
                <Text style={styles.performanceLabel}>Total Render Time</Text>
                <Text style={styles.performanceValue}>
                  {testResults.performanceMetrics.lastRenderTime.toFixed(2)}ms
                </Text>
              </View>
              <View style={styles.performanceItem}>
                <Text style={styles.performanceLabel}>Render Count</Text>
                <Text style={styles.performanceValue}>
                  {testResults.performanceMetrics.renderCount}
                </Text>
              </View>
              <View style={styles.performanceItem}>
                <Text style={styles.performanceLabel}>UI Stability</Text>
                <Text style={[
                  styles.performanceValue,
                  testResults.performanceMetrics.lastRenderTime < 100 ? styles.goodPerformance : styles.warnPerformance
                ]}>
                  {testResults.performanceMetrics.lastRenderTime < 100 ? 'Good' : 'Check'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Test Configuration */}
        <View style={styles.configCard}>
          <Text style={styles.sectionTitle}>Test Configuration</Text>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Destination:</Text>
            <Text style={styles.configValue}>{testDestination}</Text>
          </View>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Duration:</Text>
            <Text style={styles.configValue}>{testDuration}</Text>
          </View>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Budget:</Text>
            <Text style={styles.configValue}>{testBudget}</Text>
          </View>
          <View style={styles.configRow}>
            <Text style={styles.configLabel}>Interests:</Text>
            <Text style={styles.configValue}>{testInterests.join(', ')}</Text>
          </View>
        </View>

        {/* Run Test Button */}
        <TouchableOpacity
          onPress={runComparisonTest}
          disabled={isLoading}
          style={styles.testButton}
        >
          <LinearGradient
            colors={isLoading ? ['#9CA3AF', '#6B7280'] : ['#FFDE59', '#FFBD0C']}
            style={styles.testButtonGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="test-tube" size={20} color="#000" />
                <Text style={styles.testButtonText}>Run Comparison Test</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Test Results */}
        {testResults && (
          <View style={styles.resultsSection}>
            <View style={styles.resultsSummary}>
              <Text style={styles.resultsTitle}>Test Results</Text>
              <Text style={styles.resultsTimestamp}>
                {testResults.timestamp.toLocaleTimeString()}
              </Text>
              <View style={styles.summaryCard}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Activities Tested</Text>
                  <Text style={styles.summaryValue}>{testResults.comparisons.length}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Avg Improvement</Text>
                  <Text style={[
                    styles.summaryValue,
                    testResults.averageImprovement > 0 ? styles.positiveChange : styles.neutralChange
                  ]}>
                    {testResults.averageImprovement > 0 ? '+' : ''}{testResults.averageImprovement}
                  </Text>
                </View>
              </View>
            </View>

            {/* Individual Comparisons */}
            <Text style={styles.comparisonHeader}>Ranking Comparisons</Text>
            {testResults.comparisons.map((comparison, index) =>
              renderComparisonCard(comparison, index)
            )}
          </View>
        )}

        {!testResults && !isLoading && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="chart-box-outline" size={64} color="#9CA3AF" />
            <Text style={styles.emptyStateText}>No test results yet</Text>
            <Text style={styles.emptyStateDescription}>
              Run a comparison test to see baseline vs optimized ranking differences
            </Text>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 15,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    flex: 1,
    textAlign: 'center',
    marginRight: 40,
  },
  internalBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    position: 'absolute',
    right: 20,
    top: 50,
  },
  internalText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  strategyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  strategyBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  strategyBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  strategyBadgeText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#065F46',
  },
  strategyDescription: {
    fontSize: 13,
    color: '#6B7280',
    flexShrink: 1,
  },
  toggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  toggleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
    color: '#000',
  },
  configCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 12,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  configLabel: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  configValue: {
    fontSize: 14,
    color: '#000',
    fontWeight: '600',
  },
  testButton: {
    marginBottom: 24,
  },
  testButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 25,
    gap: 8,
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },
  resultsSection: {
    marginBottom: 24,
  },
  resultsSummary: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  resultsTimestamp: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 12,
  },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 12,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#D1D5DB',
    marginHorizontal: 12,
  },
  comparisonHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 12,
  },
  comparisonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  activityHeader: {
    marginBottom: 12,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
    marginBottom: 6,
  },
  categoryBadge: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  categoryText: {
    fontSize: 11,
    color: '#1E40AF',
    fontWeight: '600',
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  scoreColumn: {
    flex: 1,
    alignItems: 'center',
  },
  scoreLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  improvedScore: {
    color: '#10B981',
  },
  neutralScore: {
    color: '#6B7280',
  },
  decreasedScore: {
    color: '#EF4444',
  },
  arrowContainer: {
    paddingHorizontal: 12,
  },
  differenceContainer: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  differenceText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  positiveChange: {
    color: '#10B981',
  },
  neutralChange: {
    color: '#6B7280',
  },
  negativeChange: {
    color: '#EF4444',
  },
  percentText: {
    fontSize: 11,
    color: '#6B7280',
  },
  metadataContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metadataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  metadataText: {
    fontSize: 11,
    color: '#374151',
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 12,
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 6,
  },
  expandButtonText: {
    fontSize: 13,
    color: '#3B82F6',
    fontWeight: '600',
  },
  breakdownSection: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  breakdownContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  breakdownTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  breakdownLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  breakdownValue: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
  },
  optimizationText: {
    color: '#8B5CF6',
  },
  totalRow: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#D1D5DB',
  },
  breakdownTotalLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000',
  },
  breakdownTotalValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#000',
  },
  rankBadgeContainer: {
    alignItems: 'flex-end',
  },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  rankLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },
  rankValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#374151',
  },
  improvedRank: {
    color: '#10B981',
  },
  worsenedRank: {
    color: '#EF4444',
  },
  neutralRank: {
    color: '#6B7280',
  },
  rankChangeText: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 6,
  },
  performanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  performanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  performanceItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  performanceLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
    textAlign: 'center',
  },
  performanceValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },
  goodPerformance: {
    color: '#10B981',
  },
  warnPerformance: {
    color: '#F59E0B',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 16,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 40,
  },
});

export default AIPlannerTestingScreen;
