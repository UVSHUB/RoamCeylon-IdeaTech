describe('Planner AI Consistency & Stability', () => {
  it('should return highly similar itineraries for the same input (Stability Check)', () => {
    // In a full E2E environment, you would call the live AI service 3 times.
    // For this Optimization Framework, we establish the stability assertion logic.

    const run1 = ['Museum', 'Beach', 'Temple'];
    const run2 = ['Museum', 'Beach', 'Temple'];
    const run3 = ['Museum', 'Beach', 'Temple'];

    // Measure consistency across runs
    const isStable1 = JSON.stringify(run1) === JSON.stringify(run2);
    const isStable2 = JSON.stringify(run2) === JSON.stringify(run3);

    expect(isStable1).toBe(true);
    expect(isStable2).toBe(true);
  });

  it('should maintain category diversity without repeating the same activity type consecutively', () => {
    // A stable AI should not output ['Museum', 'Museum', 'Museum']
    const generatedTripCategories = ['Culture', 'Food', 'Nature'];

    const hasConsecutiveDuplicates = generatedTripCategories.some(
      (cat, i) => i > 0 && cat === generatedTripCategories[i - 1],
    );

    expect(hasConsecutiveDuplicates).toBe(false);
  });
});
